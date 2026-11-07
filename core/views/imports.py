import csv
import re
from collections import Counter, defaultdict
from decimal import Decimal
from datetime import datetime
from io import BytesIO, StringIO
from pathlib import Path

from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_http_methods
from pypdf import PdfReader

from core.constants import CHEQUING_DEFAULT_PROVIDER, CHEQUING_SUPPORTED_PROVIDERS
from core.models import ChequingAccount, ChequingTransaction, CreditCardAccount, CreditCardTransaction, HoldingSnapshot, ImportBatch, ImportBatchRow, Transaction
from core.services.chequing_service import normalize_chequing_category
from core.services.credit_card_categories import (
    get_user_merchant_category_map,
    infer_credit_card_category_from_merchant,
    normalize_credit_card_category,
)

SUPPORTED_IMPORT_TYPES = {"activities_csv", "tax_pdf", "auto"}
EPSILON = Decimal("0.000001")


def _is_truthy(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _parse_number(value, default=0.0):
    if value is None:
        return default
    cleaned = str(value).strip().replace(",", "")
    is_negative = cleaned.startswith("(") and cleaned.endswith(")")
    cleaned = cleaned.replace("$", "").replace("(", "").replace(")", "")
    if cleaned == "":
        return default
    parsed = float(cleaned)
    return -parsed if is_negative else parsed


def _normalize_csv_header(header):
    return re.sub(r"[^a-z0-9]", "", str(header or "").lower())


def _csv_get_value(normalized_row, *candidate_headers):
    for header in candidate_headers:
        value = normalized_row.get(_normalize_csv_header(header), "")
        if value is not None and str(value).strip() != "":
            return str(value).strip()
    return ""


def _normalize_date(raw):
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Missing date")

    for fmt in ("%Y-%m-%d", "%Y-%b-%d", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue

    raise ValueError(f"Unsupported date format: {raw}")


def _normalize_trade_date(value):
    raw = (value or "").strip()
    if not raw:
        raise ValueError("Missing trade date")

    for fmt in ("%Y-%b-%d", "%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue

    raise ValueError(f"Unsupported date format: {raw}")


def resolve_security_symbol(symbol, user_id=None):
    clean = str(symbol or "").strip().upper()
    if not clean:
        return ""
    if not user_id:
        return clean
    if clean.endswith(".TO") or clean.endswith(".TRT") or clean.endswith(".V") or clean.endswith(".NE"):
        return clean

    to_candidate = f"{clean}.TO"
    if Transaction.objects.filter(user_id=user_id, security=to_candidate).exists():
        return to_candidate
    if HoldingSnapshot.objects.filter(user_id=user_id, symbol=to_candidate).exists():
        return to_candidate
    return clean


def parse_activities_csv_text(csv_text, user_id=None):
    reader = csv.DictReader(StringIO(csv_text))
    rows = []

    for source_row_number, item in enumerate(reader, start=2):
        normalized_item = {
            _normalize_csv_header(k): v for k, v in (item or {}).items() if k is not None
        }

        # Check account type: if registered (TFSA, RRSP, FHSA), skip from non-registered ACB tracking
        account_type = _csv_get_value(normalized_item, "account_type", "account").lower()
        if account_type in {"tfsa", "rrsp", "fhsa", "resp", "rif", "tax-free", "registered"}:
            continue

        activity_type = _csv_get_value(normalized_item, "activity_type", "activity", "type", "transaction_type")
        raw_symbol = _csv_get_value(normalized_item, "symbol", "ticker", "security").upper()
        if not activity_type or not raw_symbol:
            continue

        symbol = resolve_security_symbol(raw_symbol, user_id=user_id)

        activity_upper = activity_type.upper().replace(" ", "").replace("_", "")
        sub_type = _csv_get_value(normalized_item, "activity_sub_type", "sub_type", "action").upper()
        description = _csv_get_value(normalized_item, "description", "memo", "notes")
        desc_upper = description.upper()

        mapped_type = None
        amount = 0.0
        shares = 0.0
        commission = _parse_number(_csv_get_value(normalized_item, "commission", "fee", "fees"), 0.0)

        # 1. Trades (BUY / SELL)
        if activity_upper in {"TRADE", "BUY", "SELL"}:
            quantity = _parse_number(_csv_get_value(normalized_item, "quantity", "shares", "units"), 0.0)
            net_cash = _parse_number(_csv_get_value(normalized_item, "net_cash_amount", "amount", "net_amount", "total"), 0.0)
            unit_price = _parse_number(_csv_get_value(normalized_item, "unit_price", "price"), 0.0)

            if sub_type == "BUY" or activity_upper == "BUY" or "BOUGHT" in desc_upper:
                mapped_type = "Buy"
                shares = abs(quantity)
                amount = abs(net_cash) if net_cash else abs(shares * unit_price)
            elif sub_type == "SELL" or activity_upper == "SELL" or "SOLD" in desc_upper:
                mapped_type = "Sell"
                shares = abs(quantity)
                amount = abs(net_cash) if net_cash else abs(shares * unit_price)
            else:
                continue

        # 2. Return of Capital (Adjusted Cost Base Entry Only)
        elif activity_upper in {"RETURNOFCAPITAL", "ROC"} or "RETURN OF CAPITAL" in activity_type.upper():
            mapped_type = "Return of Capital"
            raw_amt = _csv_get_value(normalized_item, "net_cash_amount", "amount", "net_amount", "total", "quantity")
            amount = abs(_parse_number(raw_amt, 0.0))
            shares = 0.0
            commission = 0.0

        # 3. Non-Cash Distribution (Adjusted Cost Base Entry Only / Phantom Distribution / Reinvested Cap Gains)
        elif activity_upper in {"NONCASHDISTRIBUTION", "PHANTOMDISTRIBUTION", "CAPITALGAINSDIVIDEND", "CAPITALGAINSDISTRIBUTION"} or "NON-CASH" in activity_type.upper() or "NON CASH" in activity_type.upper():
            mapped_type = "Capital Gains Dividend"
            raw_amt = _csv_get_value(normalized_item, "net_cash_amount", "amount", "net_amount", "total", "quantity")
            amount = abs(_parse_number(raw_amt, 0.0))
            shares = 0.0
            commission = 0.0

        # 4. Dividends & Distributions
        elif "DIVIDEND" in activity_upper or "DISTRIBUTION" in activity_upper:
            # Reinvested dividend / DRIP
            if "REINVEST" in activity_upper or "DRIP" in sub_type or "DRIP" in desc_upper:
                mapped_type = "Reinvested Dividend"
                raw_amt = _csv_get_value(normalized_item, "net_cash_amount", "amount", "net_amount", "total")
                amount = abs(_parse_number(raw_amt, 0.0))
                shares = abs(_parse_number(_csv_get_value(normalized_item, "quantity", "shares", "units"), 0.0))
                commission = 0.0
            elif "CASH DIVIDEND" in desc_upper or sub_type in {"-", ""}:
                # Pure cash dividends do not alter security ACB and are skipped to prevent double counting
                continue
            else:
                mapped_type = "Capital Gains Dividend"
                raw_amt = _csv_get_value(normalized_item, "net_cash_amount", "amount", "net_amount", "total")
                amount = abs(_parse_number(raw_amt, 0.0))
                shares = abs(_parse_number(_csv_get_value(normalized_item, "quantity", "shares", "units"), 0.0))
                commission = 0.0

        # 5. Stock Split
        elif activity_upper in {"SPLIT", "STOCKSPLIT"}:
            mapped_type = "Split"
            shares = _parse_number(_csv_get_value(normalized_item, "quantity", "shares", "units"), 0.0)
            amount = 0.0
            commission = 0.0

        else:
            continue

        raw_date = _csv_get_value(
            normalized_item,
            "effective_date",
            "transaction_date",
            "trade_date",
            "date",
            "settlement_date",
        )
        trade_date = _normalize_date(raw_date)
        amount_per_share = amount / shares if shares else 0.0

        rows.append(
            {
                "security": symbol,
                "trade_date": trade_date,
                "transaction_type": mapped_type,
                "amount": amount,
                "shares": shares,
                "amount_per_share": amount_per_share,
                "commission": commission,
                "memo": description,
                "source": "wealthsimple_activities_csv",
                "source_row_number": source_row_number,
            }
        )

    return rows


def _extract_security_from_filename(filename):
    stem = Path(filename or "").stem.upper()
    match = re.match(r"([A-Z][A-Z0-9.\-]{0,9})", stem)
    if match:
        return match.group(1)
    return ""


def _extract_tax_year(text):
    years = [int(y) for y in re.findall(r"\b(20\d{2})\b", text)]
    years = [y for y in years if 2000 <= y <= 2100]
    if not years:
        return datetime.now().year
    return Counter(years).most_common(1)[0][0]


def _extract_first_amount(text, patterns):
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
        if match:
            value = match.group(1)
            return abs(_parse_number(value, 0.0))
    return 0.0


def _extract_distribution_blocks(text):
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    date_indexes = []
    for idx, line in enumerate(lines):
        if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", line):
            date_indexes.append(idx)

    blocks = []
    for idx in range(len(date_indexes) - 1):
        record_idx = date_indexes[idx]
        payment_idx = date_indexes[idx + 1]
        if payment_idx - record_idx > 6:
            continue

        record_date = lines[record_idx]

        if idx + 2 < len(date_indexes):
            next_date_idx = date_indexes[idx + 2]
            j = next_date_idx - 1
            pre_date_numeric = 0
            while (
                j > payment_idx
                and pre_date_numeric < 2
                and re.fullmatch(r"[\d,]+(?:\.\d+)?", lines[j])
            ):
                pre_date_numeric += 1
                j -= 1
            stop_idx = next_date_idx - pre_date_numeric
        else:
            stop_idx = len(lines)

        value_lines = lines[payment_idx + 1 : stop_idx]
        values = []
        for value_line in value_lines:
            if re.fullmatch(r"[\d,]+(?:\.\d+)?", value_line):
                values.append(_parse_number(value_line, 0.0))
            elif values:
                break

        if values:
            blocks.append(
                {
                    "record_date": record_date,
                    "payment_date": lines[payment_idx],
                    "values": values,
                }
            )

    return blocks


def _guess_roc_from_values(values):
    if not values:
        return 0.0
    total_cash = values[0]
    meaningful = list(values)
    while meaningful and abs(meaningful[-1] - total_cash) < 0.0001:
        meaningful.pop()
    if len(meaningful) < 2:
        return 0.0

    roc_candidate = meaningful[-2]
    next_val = meaningful[-1]
    if roc_candidate < 0.00001:
        return 0.0

    ratio = next_val / roc_candidate if roc_candidate > 0 else 0.0
    if 1.0 < ratio <= 1.5:
        return roc_candidate
    if ratio > 1.5 and len(meaningful) >= 3:
        prev_val = meaningful[-3]
        if prev_val > 0 and roc_candidate < prev_val * 0.5:
            return roc_candidate
    return 0.0


def _extract_non_cash_mentions(text):
    mentions = []
    for match in re.finditer(
        r"non[-\s]?cash\s+distribution[^$\d]*\$\s*([\d,]+(?:\.\d+)?)",
        text,
        flags=re.IGNORECASE,
    ):
        mentions.append(abs(_parse_number(match.group(1), 0.0)))
    return mentions


def _guess_non_cash_from_values(values, non_cash_mentions):
    positive = [v for v in values if v > 0.0]
    if not positive:
        return 0.0
    for mention in non_cash_mentions:
        for value in positive:
            if abs(value - mention) <= 0.0002:
                return value
    if len(positive) >= 3:
        cash = positive[0]
        non_cash = positive[1]
        total = positive[2]
        if abs((cash + non_cash) - total) <= 0.002:
            return non_cash
    return 0.0


def parse_tax_pdf_bytes(pdf_bytes, filename):
    reader = PdfReader(BytesIO(pdf_bytes))
    text = "\n".join((page.extract_text() or "") for page in reader.pages)

    security = _extract_security_from_filename(filename)
    tax_year = _extract_tax_year(text)
    trade_date = f"{tax_year}-12-31"

    roc_amount = _extract_first_amount(
        text,
        [
            r"return\s+of\s+capital[^\d\-]*([\d,]*\.\d+)",
            r"roc[^\d\-]*([\d,]*\.\d+)",
        ],
    )
    rcg_amount = _extract_first_amount(
        text,
        [
            r"reinvested\s+capital\s+gains?(?:\s+distribution)?[^\d\-]*([\d,]*\.\d+)",
            r"capital\s+gains?\s+distribution[^\d\-]*([\d,]*\.\d+)",
        ],
    )

    rows = []
    distribution_blocks = _extract_distribution_blocks(text)
    non_cash_mentions = _extract_non_cash_mentions(text)

    for block in distribution_blocks:
        guessed_roc = _guess_roc_from_values(block["values"])
        guessed_non_cash = _guess_non_cash_from_values(block["values"], non_cash_mentions)

        if guessed_roc > 0:
            rows.append(
                {
                    "security": security,
                    "trade_date": block["record_date"],
                    "transaction_type": "Return of Capital",
                    "amount": guessed_roc,
                    "shares": 0.0,
                    "amount_per_share": 0.0,
                    "commission": 0.0,
                    "source": "tax_pdf",
                }
            )

        if guessed_non_cash > 0:
            rows.append(
                {
                    "security": security,
                    "trade_date": block["record_date"],
                    "transaction_type": "Reinvested Capital Gains Distribution",
                    "amount": guessed_non_cash,
                    "shares": 0.0,
                    "amount_per_share": 0.0,
                    "commission": 0.0,
                    "source": "tax_pdf",
                }
            )

    if not rows and roc_amount > 0:
        rows.append(
            {
                "security": security,
                "trade_date": trade_date,
                "transaction_type": "Return of Capital",
                "amount": roc_amount,
                "shares": 0.0,
                "amount_per_share": 0.0,
                "commission": 0.0,
                "source": "tax_pdf",
            }
        )

    has_rcg = any(row["transaction_type"] == "Reinvested Capital Gains Distribution" for row in rows)
    if rcg_amount > 0 and not has_rcg:
        rows.append(
            {
                "security": security,
                "trade_date": trade_date,
                "transaction_type": "Reinvested Capital Gains Distribution",
                "amount": rcg_amount,
                "shares": 0.0,
                "amount_per_share": 0.0,
                "commission": 0.0,
                "source": "tax_pdf",
            }
        )

    return rows


def _extract_iso_date(value):
    text = str(value or "").strip()
    match = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
    if match:
        return match.group(1)
    match_slash = re.search(r"\b(20\d{2}/\d{2}/\d{2})\b", text)
    if match_slash:
        return match_slash.group(1).replace("/", "-")
    match_us = re.search(r"\b(\d{1,2}/\d{1,2}/20\d{2})\b", text)
    if match_us:
        try:
            return datetime.strptime(match_us.group(1), "%m/%d/%Y").strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def _extract_as_of_date(csv_text, filename=""):
    for line in csv_text.splitlines():
        maybe_date = _extract_iso_date(line)
        if maybe_date:
            return maybe_date
    fallback = _extract_iso_date(filename)
    if fallback:
        return fallback
    return datetime.now().strftime("%Y-%m-%d")


def parse_holdings_csv_text(csv_text, filename=""):
    as_of = _extract_as_of_date(csv_text, filename)
    rows = []
    reader = csv.DictReader(StringIO(csv_text))

    for item in reader:
        normalized_item = {
            _normalize_csv_header(k): v for k, v in (item or {}).items() if k is not None
        }
        symbol = _csv_get_value(normalized_item, "Symbol", "symbol", "ticker", "security").upper()
        account_number = _csv_get_value(normalized_item, "Account Number", "account_number", "account_num", "account")
        account_name = _csv_get_value(normalized_item, "Account Name", "account_name", "account")
        if not symbol or not account_number or not account_name:
            continue

        rows.append(
            {
                "as_of": as_of,
                "account_name": account_name,
                "account_type": _csv_get_value(normalized_item, "Account Type", "account_type"),
                "account_classification": _csv_get_value(normalized_item, "Account Classification", "account_classification"),
                "account_number": account_number,
                "symbol": symbol,
                "exchange": _csv_get_value(normalized_item, "Exchange", "exchange"),
                "mic": _csv_get_value(normalized_item, "MIC", "mic"),
                "security_name": _csv_get_value(normalized_item, "Name", "security_name", "name", "description"),
                "security_type": _csv_get_value(normalized_item, "Security Type", "security_type"),
                "quantity": _parse_number(_csv_get_value(normalized_item, "Quantity", "quantity", "shares"), 0.0),
                "market_price": _parse_number(_csv_get_value(normalized_item, "Market Price", "market_price", "price"), 0.0),
                "market_price_currency": _csv_get_value(normalized_item, "Market Price Currency", "currency", "price_currency"),
                "book_value_cad": _parse_number(_csv_get_value(normalized_item, "Book Value (CAD)", "book_value_cad", "book_value"), 0.0),
                "market_value": _parse_number(_csv_get_value(normalized_item, "Market Value", "market_value", "total_value"), 0.0),
                "market_value_currency": _csv_get_value(normalized_item, "Market Value Currency", "market_value_currency"),
                "unrealized_return": _parse_number(_csv_get_value(normalized_item, "Market Unrealized Returns", "unrealized_return", "gain"), 0.0),
            }
        )

    return rows


def _normalize_csv_header(header):
    return re.sub(r"[^a-z0-9]", "", str(header or "").lower())


def _csv_get_value(normalized_row, *candidate_headers):
    for header in candidate_headers:
        value = normalized_row.get(_normalize_csv_header(header), "")
        if value is not None and str(value).strip() != "":
            return str(value).strip()
    return ""


def _normalize_credit_card_date(raw):
    value = str(raw or "").strip()
    if not value:
        return ""

    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y", "%d-%b-%Y", "%d-%B-%Y"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue

    return value


def parse_rogers_credit_csv_text(csv_text, card_label=None):
    rows = []
    reader = csv.DictReader(StringIO(csv_text))

    for item in reader:
        normalized_item = {
            _normalize_csv_header(key): value for key, value in (item or {}).items() if key is not None
        }

        tx_date = _normalize_credit_card_date(_csv_get_value(normalized_item, "Date", "Transaction Date"))
        if not tx_date:
            continue

        amount = _parse_number(_csv_get_value(normalized_item, "Amount"), 0.0)
        card_number = _csv_get_value(normalized_item, "Transaction Card Number", "Card Number")
        card_last4 = card_number[-4:] if len(card_number) >= 4 else ""
        merchant_category = normalize_credit_card_category(
            _csv_get_value(normalized_item, "Merchant Category", "Merchant Category Description")
        )

        rows.append(
            {
                "provider": "rogers_bank",
                "card_label": card_label or "Rogers Bank",
                "transaction_date": tx_date,
                "posted_date": _normalize_credit_card_date(_csv_get_value(normalized_item, "Posted Date")),
                "reference_number": _csv_get_value(normalized_item, "Reference Number").replace('"', ""),
                "activity_type": _csv_get_value(normalized_item, "Activity Type"),
                "status": _csv_get_value(normalized_item, "Status", "Activity Status"),
                "card_last4": card_last4,
                "merchant_category": merchant_category,
                "merchant_name": _csv_get_value(normalized_item, "Merchant Name"),
                "merchant_city": _csv_get_value(normalized_item, "Merchant City"),
                "merchant_region": _csv_get_value(normalized_item, "Merchant State/Province", "Merchant State or Province"),
                "merchant_country": _csv_get_value(normalized_item, "Merchant Country", "Merchant Country Code"),
                "merchant_postal": _csv_get_value(normalized_item, "Merchant Postal Code/Zip", "Merchant Postal Code"),
                "amount": amount,
                "rewards": _parse_number(_csv_get_value(normalized_item, "Rewards"), 0.0),
                "cardholder_name": _csv_get_value(normalized_item, "Name on Card"),
            }
        )

    return rows


def parse_wealthsimple_credit_csv_text(csv_text, card_label=None, user_category_map=None):
    """
    Parses Wealthsimple credit card CSV files. Supports two formats:
    1. Custom document export (transaction_date, transaction_type, status, merchant, amount, currency, notes, category)
    2. Monthly statement export (transaction_date, post_date, type, details, amount, currency)
    """
    rows = []
    reader = csv.DictReader(StringIO(csv_text))

    for item in reader:
        normalized_item = {
            _normalize_csv_header(key): value for key, value in (item or {}).items() if key is not None
        }

        tx_date = _normalize_credit_card_date(
            _csv_get_value(normalized_item, "transaction_date", "date", "trans_date")
        )
        if not tx_date:
            continue

        posted_date = _normalize_credit_card_date(
            _csv_get_value(normalized_item, "post_date", "posted_date")
        )
        tx_type = _csv_get_value(normalized_item, "transaction_type", "type", "activity_type")
        status = _csv_get_value(normalized_item, "status")
        merchant = _csv_get_value(normalized_item, "merchant", "details", "description", "payee")
        raw_category = _csv_get_value(normalized_item, "category", "merchant_category")
        raw_amount = _parse_number(_csv_get_value(normalized_item, "amount", "total"), 0.0)

        # In FinGlass:
        # Expenses/purchases must be positive (amount > 0).
        # Payments, refunds, and credits must be negative (amount < 0).
        type_lower = (tx_type or "").lower()
        if "payment" in type_lower or "refund" in type_lower or "credit" in type_lower:
            amount = -abs(raw_amount)
        elif "purchase" in type_lower or "debit" in type_lower:
            amount = abs(raw_amount)
        else:
            amount = raw_amount

        merchant_name = merchant
        if not merchant_name and "payment" in type_lower:
            merchant_name = "Payment"

        # Determine category (using user's 1400+ historical transactions, CSV category, and keyword rules)
        category = infer_credit_card_category_from_merchant(
            merchant_name,
            tx_type=tx_type,
            user_category_map=user_category_map,
            raw_category=raw_category,
        )

        rows.append(
            {
                "provider": "wealthsimple",
                "card_label": card_label or "Wealthsimple",
                "transaction_date": tx_date,
                "posted_date": posted_date or tx_date,
                "reference_number": "",
                "activity_type": tx_type or ("Payment" if amount < 0 else "Purchase"),
                "status": status or "Posted",
                "card_last4": "",
                "merchant_category": category,
                "merchant_name": merchant_name,
                "merchant_city": "",
                "merchant_region": "",
                "merchant_country": _csv_get_value(normalized_item, "currency") or "CAD",
                "merchant_postal": "",
                "amount": amount,
                "rewards": 0.0,
                "cardholder_name": "",
            }
        )

    return rows


def detect_credit_card_provider(csv_text, fallback="rogers"):
    try:
        reader = csv.DictReader(StringIO(csv_text))
        fieldnames = [str(f or "").strip().lower() for f in (reader.fieldnames or [])]
        normalized_headers = {_normalize_csv_header(h) for h in fieldnames}

        # Wealthsimple specific headers:
        # Format 1 (statement): details, type, transaction_date/post_date
        # Format 2 (custom): transaction_type, merchant, category, notes, transaction_date
        if (
            ("details" in normalized_headers and "type" in normalized_headers and ("transactiondate" in normalized_headers or "postdate" in normalized_headers))
            or ("transactiontype" in normalized_headers and ("merchant" in normalized_headers or "category" in normalized_headers))
            or ("transactiondate" in normalized_headers and "merchant" in normalized_headers and "category" in normalized_headers)
        ):
            return "wealthsimple"

        # Rogers specific headers
        if any(h in normalized_headers for h in ("merchantname", "nameoncard", "rewards", "transactioncardnumber", "merchantcategory")):
            return "rogers"
    except Exception:
        pass

    try:
        rows = parse_wealthsimple_credit_csv_text(csv_text)
        if rows:
            return "wealthsimple"
    except Exception:
        pass

    try:
        rows = parse_rogers_credit_csv_text(csv_text)
        if rows:
            return "rogers"
    except Exception:
        pass

    return fallback


def parse_credit_csv_text(csv_text, provider="auto", card_label=None, user_category_map=None):
    provider_value = str(provider or "").strip().lower()

    if not provider_value or provider_value in {"auto", "detect"}:
        provider_value = detect_credit_card_provider(csv_text)

    if provider_value in {"wealthsimple", "ws"}:
        try:
            return parse_wealthsimple_credit_csv_text(csv_text, card_label=card_label, user_category_map=user_category_map)
        except Exception:
            pass

    if provider_value in {"rogers", "rogers_bank"}:
        try:
            return parse_rogers_credit_csv_text(csv_text, card_label=card_label)
        except Exception:
            pass

    detected = detect_credit_card_provider(csv_text)
    if detected in {"wealthsimple", "ws"}:
        return parse_wealthsimple_credit_csv_text(csv_text, card_label=card_label, user_category_map=user_category_map)
    return parse_rogers_credit_csv_text(csv_text, card_label=card_label)


def _normalize_credit_card_provider_name(value):
    raw = str(value or "").strip().lower()
    if raw in {"rogers", "rogers_bank"}:
        return "rogers_bank"
    if raw in {"wealthsimple", "ws"}:
        return "wealthsimple"
    return ""


def parse_chequing_courant_csv_text(csv_text, account_label=None):
    """
    Parses Chequing CSV files.
    Supports Wealthsimple custom activity statement export:
    (transaction_date, transaction_time, account_number, account_type, transaction_type,
     transaction_sub_type, status, payee, payee_email, amount, currency, notes)
    as well as legacy format:
    (date, transaction, description, amount, balance)
    """
    normalized_account_label = str(account_label or "").strip()

    rows = []
    reader = csv.DictReader(StringIO(csv_text))

    for item in reader:
        normalized_item = {
            _normalize_csv_header(key): value for key, value in (item or {}).items() if key is not None
        }

        # Check status (Wealthsimple custom activity exports include status e.g. Completed, In Progress, Cancelled)
        status = _csv_get_value(normalized_item, "status").strip().lower()
        if status in {"cancelled", "failed", "declined", "void"}:
            continue

        tx_date = _normalize_credit_card_date(
            _csv_get_value(normalized_item, "transaction_date", "date", "transaction date")
        )
        if not tx_date:
            continue

        tx_type = _csv_get_value(normalized_item, "transaction_type", "type")
        tx_sub_type = _csv_get_value(normalized_item, "transaction_sub_type", "sub_type")
        payee = _csv_get_value(normalized_item, "payee")
        payee_email = _csv_get_value(normalized_item, "payee_email")
        notes = _csv_get_value(normalized_item, "notes")

        # Determine description
        if payee:
            if payee_email:
                description = f"{payee} ({payee_email})"
            else:
                description = payee
        else:
            legacy_desc = _csv_get_value(normalized_item, "description", "details", "memo")
            if legacy_desc:
                description = legacy_desc
            elif tx_type and tx_sub_type:
                description = f"{tx_type} - {tx_sub_type}"
            elif tx_type:
                description = tx_type
            else:
                description = "Wealthsimple Chequing"

        if notes and notes.lower() not in description.lower():
            description = f"{description} - {notes}" if description else notes

        # Parse amounts
        raw_amount = _parse_number(_csv_get_value(normalized_item, "amount"), 0.0)
        t_lower = tx_type.lower()
        st_lower = tx_sub_type.lower()
        if t_lower in {"withdrawal", "spend", "credit card payment"} or st_lower in {"send", "source"}:
            amount = -abs(raw_amount)
        elif t_lower in {"deposit", "interest", "promotion", "reimbursement", "overdraft transfer"} or st_lower in {"received", "send received", "destination"}:
            amount = abs(raw_amount)
        else:
            amount = raw_amount

        # Balance (optional in Wealthsimple custom activities)
        raw_balance = _csv_get_value(normalized_item, "balance")
        balance = _parse_number(raw_balance, 0.0) if raw_balance != "" else None

        # Determine transaction_code
        legacy_code = _csv_get_value(normalized_item, "transaction", "transaction code")
        if legacy_code:
            transaction_code = legacy_code
        elif t_lower == "internal transfer":
            transaction_code = "TRFOUT" if st_lower == "source" or amount < 0 else "TRFIN"
        elif t_lower == "overdraft transfer":
            transaction_code = "TRFIN"
        elif t_lower == "withdrawal":
            if "e transfer" in st_lower or "etransfer" in st_lower:
                transaction_code = "E_TRFOUT"
            elif "bill pay" in st_lower or "bill_pay" in st_lower:
                transaction_code = "OBP_OUT"
            elif st_lower in {"aft", "eft"}:
                transaction_code = "AFT_OUT"
            else:
                transaction_code = "WITHDRAWAL"
        elif t_lower == "deposit":
            if "e transfer" in st_lower or "etransfer" in st_lower:
                transaction_code = "E_TRFIN"
            elif st_lower in {"aft", "cheque"}:
                transaction_code = "AFT_IN"
            else:
                transaction_code = "DEPOSIT"
        elif t_lower in {"p 2 p payment", "p2p payment", "p2p"}:
            transaction_code = "P2P_RECEIVED" if "receive" in st_lower or amount > 0 else "P2P_SENT"
        elif t_lower == "interest":
            transaction_code = "INT"
        elif t_lower == "spend":
            transaction_code = "SPEND"
        elif t_lower == "credit card payment":
            transaction_code = "AFT_OUT"
        elif tx_type or tx_sub_type:
            transaction_code = f"{tx_type}_{tx_sub_type}".strip("_").replace(" ", "_").upper()
        else:
            transaction_code = "CHEQUING"

        currency = _csv_get_value(normalized_item, "currency") or "CAD"

        # Determine target account label
        if normalized_account_label:
            row_account_label = normalized_account_label
        else:
            account_type = _csv_get_value(normalized_item, "account_type")
            if account_type:
                row_account_label = f"Wealthsimple {account_type}"
            else:
                row_account_label = "Wealthsimple Chequing"

        category = normalize_chequing_category(
            transaction_code=transaction_code,
            description=description,
            amount=amount,
            tx_type=tx_type,
            sub_type=tx_sub_type,
        )

        rows.append(
            {
                "account_label": row_account_label,
                "transaction_date": tx_date,
                "transaction_code": transaction_code,
                "description": description,
                "category": category,
                "amount": amount,
                "balance": balance,
                "currency": currency,
            }
        )

    return rows


def parse_upload(import_type, filename, file_bytes, user_id=None):
    ext = Path(filename or "").suffix.lower()
    if ext == ".pdf" or import_type == "tax_pdf":
        return parse_tax_pdf_bytes(file_bytes, filename)
    if ext == ".csv" or import_type == "activities_csv" or import_type == "auto":
        return parse_activities_csv_text(file_bytes.decode("utf-8-sig"), user_id=user_id)
    if import_type == "tax_pdf":
        return parse_tax_pdf_bytes(file_bytes, filename)
    raise ValueError("Unsupported import type")


def _to_decimal(value):
    return Decimal(str(value or 0))


def _build_memo_filter(memo):
    normalized = str(memo or "")
    return {"memo": normalized} if normalized else {"memo__in": ["", None]}


def _transaction_signature_key(tx):
    amount = _to_decimal(tx.get("amount", 0)).quantize(Decimal("0.000001"))
    shares = _to_decimal(tx.get("shares", 0)).quantize(Decimal("0.00000001"))
    commission = _to_decimal(tx.get("commission", 0)).quantize(Decimal("0.000001"))
    memo = str(tx.get("memo") or "")
    return (
        str(tx.get("security") or "").strip().upper(),
        str(tx.get("trade_date") or ""),
        str(tx.get("transaction_type") or "").strip(),
        str(amount),
        str(shares),
        str(commission),
        memo,
    )


def _count_existing_transactions(user_id, tx):
    amount = _to_decimal(tx.get("amount", 0))
    shares = _to_decimal(tx.get("shares", 0))
    commission = _to_decimal(tx.get("commission", 0))
    memo_filter = _build_memo_filter(tx.get("memo", ""))
    return Transaction.objects.filter(
        user_id=user_id,
        security=str(tx.get("security") or "").strip().upper(),
        trade_date=tx["trade_date"],
        transaction_type=str(tx.get("transaction_type") or "").strip(),
        amount__gte=amount - EPSILON,
        amount__lte=amount + EPSILON,
        shares__gte=shares - EPSILON,
        shares__lte=shares + EPSILON,
        commission__gte=commission - EPSILON,
        commission__lte=commission + EPSILON,
        **memo_filter,
    ).count()


def _evaluate_import_rows_deduplication(rows, user_id):
    """
    Annotates each row with:
      - is_duplicate (bool)
      - duplicate_reason (str: "already_in_ledger", "duplicate_in_upload", or "")
    
    Ensures that:
    1. If a document is uploaded twice (or multiple documents uploaded at once contain identical transactions),
       the identical duplicate transactions across files are recognized and marked as duplicate_in_upload.
    2. If a document's transactions were already imported into the ledger (Transaction table),
       even under a different filename, they are recognized and marked as already_in_ledger.
    """
    db_counts = {}
    for r in rows:
        key = _transaction_signature_key(r)
        if key not in db_counts:
            db_counts[key] = _count_existing_transactions(user_id, r)

    max_seen_in_prev_files = defaultdict(int)
    file_seen_sigs = defaultdict(int)
    current_file_idx = None

    annotated_rows = []
    duplicate_in_upload = 0
    already_in_ledger = 0
    new_rows = 0

    for row in rows:
        file_idx = row.get("file_index", 1)
        if current_file_idx is not None and file_idx != current_file_idx:
            for k, cnt in file_seen_sigs.items():
                max_seen_in_prev_files[k] = max(max_seen_in_prev_files[k], cnt)
            file_seen_sigs = defaultdict(int)
        current_file_idx = file_idx

        sig = _transaction_signature_key(row)
        file_seen_sigs[sig] += 1
        occurrence = file_seen_sigs[sig]

        annotated_row = dict(row)

        if occurrence <= max_seen_in_prev_files[sig]:
            annotated_row["is_duplicate"] = True
            annotated_row["duplicate_reason"] = "duplicate_in_upload"
            duplicate_in_upload += 1
        elif occurrence <= db_counts.get(sig, 0):
            annotated_row["is_duplicate"] = True
            annotated_row["duplicate_reason"] = "already_in_ledger"
            already_in_ledger += 1
        else:
            annotated_row["is_duplicate"] = False
            annotated_row["duplicate_reason"] = ""
            new_rows += 1

        annotated_rows.append(annotated_row)

    for k, cnt in file_seen_sigs.items():
        max_seen_in_prev_files[k] = max(max_seen_in_prev_files[k], cnt)

    stats = {
        "duplicate_in_upload": duplicate_in_upload,
        "already_in_ledger": already_in_ledger,
        "new_rows": new_rows,
        "total_rows": len(rows),
    }
    return annotated_rows, stats


def _annotate_transaction_import_duplicates(rows):
    signature_counts = Counter(_transaction_signature_key(row) for row in rows)
    seen_counts = Counter()
    duplicate_groups = sum(1 for count in signature_counts.values() if count > 1)
    duplicate_rows = sum(count for count in signature_counts.values() if count > 1)
    annotated_rows = []

    for row in rows:
        key = _transaction_signature_key(row)
        group_size = signature_counts[key]
        annotated_row = dict(row)
        if group_size > 1:
            seen_counts[key] += 1
            annotated_row["duplicate_in_import"] = True
            annotated_row["duplicate_group_size"] = group_size
            annotated_row["duplicate_group_index"] = seen_counts[key]
        annotated_rows.append(annotated_row)

    return annotated_rows, duplicate_groups, duplicate_rows


def _build_transaction_duplicate_warnings(duplicate_groups=0, duplicate_rows=0, skipped_existing=0, stats=None):
    warnings = []
    if stats:
        dup_upload = stats.get("duplicate_in_upload", 0)
        in_ledger = stats.get("already_in_ledger", 0)
        new_rows = stats.get("new_rows", 0)
        total_rows = stats.get("total_rows", 0)
        if dup_upload > 0:
            row_label = "transaction" if dup_upload == 1 else "transactions"
            warnings.append(
                f"Recognized {dup_upload} duplicate {row_label} across uploaded documents. They will not be duplicated."
            )
        if in_ledger > 0:
            row_label = "transaction" if in_ledger == 1 else "transactions"
            warnings.append(
                f"Recognized {in_ledger} {row_label} already present in your ledger. They will not be duplicated."
            )
        if total_rows > 0 and new_rows == 0:
            warnings.append(
                "All transactions in this upload already exist in your ledger or duplicate across files. No new transactions will be added."
            )
        return warnings

    if duplicate_groups > 0 and duplicate_rows > 0:
        group_label = "group" if duplicate_groups == 1 else "groups"
        row_label = "row" if duplicate_rows == 1 else "rows"
        warnings.append(
            f"This upload contains {duplicate_groups} identical transaction {group_label} spanning "
            f"{duplicate_rows} {row_label}. Duplicate transactions will not be duplicated."
        )

    if skipped_existing > 0:
        row_label = "row" if skipped_existing == 1 else "rows"
        warnings.append(
            f"Skipped {skipped_existing} {row_label} because matching transaction(s) are already in your ledger."
        )

    return warnings


def _import_transactions_rows(parsed_rows, user_id):
    inserted = 0
    skipped_existing = 0
    annotated_rows, stats = _evaluate_import_rows_deduplication(parsed_rows, user_id)
    active_rows = [tx for tx in annotated_rows if not tx.get("is_duplicate")]
    skipped_duplicates = len(annotated_rows) - len(active_rows)
    skipped_existing += skipped_duplicates

    grouped_rows = {}
    signature_order = []

    for tx in active_rows:
        key = _transaction_signature_key(tx)
        if key not in grouped_rows:
            grouped_rows[key] = []
            signature_order.append(key)
        grouped_rows[key].append(tx)

    with transaction.atomic():
        for key in signature_order:
            group_rows = grouped_rows[key]
            exemplar = group_rows[0]
            amount = _to_decimal(exemplar["amount"])
            shares = _to_decimal(exemplar["shares"])
            commission = _to_decimal(exemplar["commission"])
            memo_filter = _build_memo_filter(exemplar.get("memo", ""))
            existing_count = Transaction.objects.filter(
                user_id=user_id,
                security=exemplar["security"],
                trade_date=exemplar["trade_date"],
                transaction_type=exemplar["transaction_type"],
                amount__gte=amount - EPSILON,
                amount__lte=amount + EPSILON,
                shares__gte=shares - EPSILON,
                shares__lte=shares + EPSILON,
                commission__gte=commission - EPSILON,
                commission__lte=commission + EPSILON,
                **memo_filter,
            ).count()

            rows_to_insert = max(0, len(group_rows) - existing_count)
            skipped_existing += len(group_rows) - rows_to_insert
            for tx in group_rows[:rows_to_insert]:
                memo = str(tx.get("memo") or "")
                Transaction.objects.create(
                    user_id=user_id,
                    security=tx["security"],
                    trade_date=tx["trade_date"],
                    transaction_type=tx["transaction_type"],
                    amount=amount,
                    shares=shares,
                    amount_per_share=_to_decimal(tx["amount_per_share"]),
                    commission=commission,
                    memo=memo,
                    source=tx.get("source", "import_review"),
                )
                inserted += 1

    warnings = _build_transaction_duplicate_warnings(stats=stats)
    return {
        "parsed": len(parsed_rows),
        "inserted": inserted,
        "imported": inserted,
        "committed_rows": inserted,
        "skipped": skipped_existing,
        "skipped_existing": skipped_existing,
        "duplicate_groups": stats["duplicate_in_upload"] + stats["already_in_ledger"],
        "duplicate_rows": stats["duplicate_in_upload"] + stats["already_in_ledger"],
        "duplicate_in_upload": stats["duplicate_in_upload"],
        "already_in_ledger": stats["already_in_ledger"],
        "warnings": warnings,
    }


def _import_holdings_rows(parsed_rows, source_filename, user_id):
    inserted = 0
    updated = 0

    for row in parsed_rows:
        _, created = HoldingSnapshot.objects.update_or_create(
            user_id=user_id,
            as_of=row["as_of"],
            account_number=row["account_number"],
            symbol=row["symbol"],
            defaults={
                "account_name": row["account_name"],
                "account_type": row.get("account_type", ""),
                "account_classification": row.get("account_classification", ""),
                "exchange": row.get("exchange", ""),
                "mic": row.get("mic", ""),
                "security_name": row.get("security_name", ""),
                "security_type": row.get("security_type", ""),
                "quantity": _to_decimal(row.get("quantity", 0.0)),
                "market_price": _to_decimal(row.get("market_price", 0.0)),
                "market_price_currency": row.get("market_price_currency", ""),
                "book_value_cad": _to_decimal(row.get("book_value_cad", 0.0)),
                "market_value": _to_decimal(row.get("market_value", 0.0)),
                "market_value_currency": row.get("market_value_currency", ""),
                "unrealized_return": _to_decimal(row.get("unrealized_return", 0.0)),
                "source_filename": source_filename,
                "imported_at": timezone.now(),
            },
        )

        if created:
            inserted += 1
        else:
            updated += 1

    unique_as_of = sorted({row["as_of"] for row in parsed_rows})
    return {
        "parsed": len(parsed_rows),
        "inserted": inserted,
        "updated": updated,
        "as_of": unique_as_of[-1] if unique_as_of else None,
    }


def _import_rogers_credit_rows(parsed_rows, source_filename, user_id):
    inserted = 0
    for row in parsed_rows:
        provider = str(row.get("provider") or "").strip()
        card_label = str(row.get("card_label") or provider).strip()
        if card_label and provider:
            CreditCardAccount.objects.get_or_create(
                user_id=user_id,
                label=card_label,
                defaults={"provider": provider},
            )

        amount = _to_decimal(row["amount"])
        merchant_name = row.get("merchant_name", "")
        posted_date = row.get("posted_date") or None
        merchant_filter = {"merchant_name": merchant_name} if merchant_name else {"merchant_name__in": ["", None]}
        existing = CreditCardTransaction.objects.filter(
            user_id=user_id,
            provider=provider,
            transaction_date=row["transaction_date"],
            posted_date=posted_date,
            card_last4=row.get("card_last4", ""),
            reference_number=row.get("reference_number", ""),
            amount__gte=amount - EPSILON,
            amount__lte=amount + EPSILON,
            **merchant_filter,
        ).exists()
        if existing:
            continue

        CreditCardTransaction.objects.create(
            user_id=user_id,
            provider=provider,
            card_label=row.get("card_label") or None,
            transaction_date=row["transaction_date"],
            posted_date=posted_date,
            reference_number=row.get("reference_number", ""),
            activity_type=row.get("activity_type", ""),
            status=row.get("status", ""),
            card_last4=row.get("card_last4", ""),
            merchant_category=row.get("merchant_category", ""),
            merchant_name=merchant_name,
            merchant_city=row.get("merchant_city", ""),
            merchant_region=row.get("merchant_region", ""),
            merchant_country=row.get("merchant_country", ""),
            merchant_postal=row.get("merchant_postal", ""),
            amount=amount,
            rewards=_to_decimal(row.get("rewards", 0.0)),
            is_hidden=False,
            cardholder_name=row.get("cardholder_name", ""),
            source_filename=source_filename,
            imported_at=timezone.now(),
        )
        inserted += 1

    return {"parsed": len(parsed_rows), "inserted": inserted, "skipped": len(parsed_rows) - inserted}


def _import_chequing_rows(parsed_rows, source_filename, user_id):
    inserted = 0
    seen_in_batch = defaultdict(int)

    for row in parsed_rows:
        amount = _to_decimal(row["amount"])
        raw_balance = row.get("balance")
        balance = _to_decimal(raw_balance) if raw_balance is not None else None
        transaction_code = str(row.get("transaction_code") or "").strip()
        description = str(row.get("description") or "").strip()
        account_label = str(row.get("account_label") or "").strip()
        if not account_label:
            continue

        sig = (account_label, row["transaction_date"], transaction_code, str(amount), description)
        seen_in_batch[sig] += 1
        occurrence_in_batch = seen_in_batch[sig]

        description_filter = {"description": description} if description else {"description__in": ["", None]}
        query_filter = {
            "user_id": user_id,
            "account_label": account_label,
            "transaction_date": row["transaction_date"],
            "transaction_code": transaction_code,
            "amount__gte": amount - EPSILON,
            "amount__lte": amount + EPSILON,
            **description_filter,
        }
        if balance is not None:
            query_filter["balance__gte"] = balance - EPSILON
            query_filter["balance__lte"] = balance + EPSILON

        existing_count = ChequingTransaction.objects.filter(**query_filter).count()
        if occurrence_in_batch <= existing_count:
            continue

        ChequingAccount.objects.get_or_create(
            user_id=user_id,
            label=account_label,
            defaults={"provider": CHEQUING_DEFAULT_PROVIDER},
        )

        ChequingTransaction.objects.create(
            user_id=user_id,
            account_label=account_label,
            transaction_date=row["transaction_date"],
            transaction_code=transaction_code,
            description=description,
            category=row.get("category") or normalize_chequing_category(transaction_code, description, amount),
            amount=amount,
            balance=balance,
            currency=row.get("currency") or "CAD",
            source_filename=source_filename,
            imported_at=timezone.now(),
        )
        inserted += 1

    return {"parsed": len(parsed_rows), "inserted": inserted, "skipped": len(parsed_rows) - inserted}


def _create_import_batch(source_type, source_filename, rows, user_id):
    batch = ImportBatch.objects.create(
        user_id=user_id,
        source_type=source_type,
        source_filename=(source_filename[:250] if source_filename else ""),
        status="staged",
    )
    batch_id = batch.id

    for idx, row in enumerate(rows, start=1):
        ImportBatchRow.objects.create(
            batch_id=batch_id,
            row_order=idx,
            security=row["security"],
            trade_date=row["trade_date"],
            transaction_type=row["transaction_type"],
            amount=_to_decimal(row["amount"]),
            shares=_to_decimal(row["shares"]),
            amount_per_share=_to_decimal(row.get("amount_per_share", 0.0)),
            commission=_to_decimal(row.get("commission", 0.0)),
            source=row.get("source", source_type),
            is_duplicate=bool(row.get("is_duplicate", False)),
            duplicate_reason=str(row.get("duplicate_reason") or ""),
        )

    return batch_id


def _get_batch(batch_id, user_id):
    batch = ImportBatch.objects.filter(id=batch_id, user_id=user_id).values().first()
    if not batch:
        return None
    rows = list(
        ImportBatchRow.objects.filter(batch_id=batch_id)
        .order_by("row_order", "id")
        .values(
            "id",
            "batch_id",
            "row_order",
            "security",
            "trade_date",
            "transaction_type",
            "amount",
            "shares",
            "amount_per_share",
            "commission",
            "source",
            "is_duplicate",
            "duplicate_reason",
        )
    )
    return {"batch": batch, "rows": rows}


def _update_batch_row(batch_id, row_id, payload, user_id):
    row = (
        ImportBatchRow.objects.select_related("batch")
        .filter(id=row_id, batch_id=batch_id, batch__user_id=user_id)
        .first()
    )
    if not row:
        return False

    security = str(payload.get("security") or "").strip().upper()
    trade_date = _normalize_date(str(payload.get("trade_date") or ""))
    transaction_type = str(payload.get("transaction_type") or "").strip()
    amount = float(payload.get("amount") or 0)
    shares = float(payload.get("shares") or 0)
    commission = float(payload.get("commission") or 0)
    amount_per_share = amount / shares if shares else 0.0

    row.security = security
    row.trade_date = trade_date
    row.transaction_type = transaction_type
    row.amount = _to_decimal(amount)
    row.shares = _to_decimal(shares)
    row.amount_per_share = _to_decimal(amount_per_share)
    row.commission = _to_decimal(commission)

    existing_count = _count_existing_transactions(
        user_id,
        {
            "security": security,
            "trade_date": trade_date,
            "transaction_type": transaction_type,
            "amount": amount,
            "shares": shares,
            "commission": commission,
        },
    )
    if existing_count > 0:
        row.is_duplicate = True
        row.duplicate_reason = "already_in_ledger"
    else:
        row.is_duplicate = False
        row.duplicate_reason = ""

    row.save(update_fields=["security", "trade_date", "transaction_type", "amount", "shares", "amount_per_share", "commission", "is_duplicate", "duplicate_reason"])
    return True


def _delete_batch_row(batch_id, row_id, user_id):
    deleted, _ = ImportBatchRow.objects.filter(id=row_id, batch_id=batch_id, batch__user_id=user_id).delete()
    return deleted > 0


def _commit_batch(batch_id, user_id):
    batch = ImportBatch.objects.filter(id=batch_id, user_id=user_id).first()
    if not batch:
        return None
    if batch.status == "committed":
        return {"inserted": 0, "parsed": 0, "already_committed": True}

    rows = list(
        ImportBatchRow.objects.filter(batch_id=batch_id)
        .order_by("row_order", "id")
        .values("security", "trade_date", "transaction_type", "amount", "shares", "amount_per_share", "commission", "source", "is_duplicate", "duplicate_reason")
    )

    non_duplicate_rows = [
        {
            "security": row["security"],
            "trade_date": row["trade_date"],
            "transaction_type": row["transaction_type"],
            "amount": row["amount"],
            "shares": row["shares"],
            "amount_per_share": row["amount_per_share"],
            "commission": row["commission"],
            "source": row["source"],
        }
        for row in rows
        if not row.get("is_duplicate")
    ]
    skipped_duplicates = len(rows) - len(non_duplicate_rows)

    summary = _import_transactions_rows(non_duplicate_rows, user_id)
    summary["parsed"] = len(rows)
    summary["skipped_duplicates"] = skipped_duplicates
    summary["skipped_existing"] = summary.get("skipped_existing", 0) + skipped_duplicates
    summary["skipped"] = summary["skipped_existing"]

    batch.status = "committed"
    batch.committed_at = timezone.now()
    batch.save(update_fields=["status", "committed_at"])
    return summary


@require_http_methods(["POST"])
def import_activities_csv(request):
    user_id = request.user.id
    uploaded_files = []
    seen_file_ids = set()
    for key in ("file", "files"):
        for f in request.FILES.getlist(key):
            if f and f.name and id(f) not in seen_file_ids:
                seen_file_ids.add(id(f))
                uploaded_files.append(f)

    if not uploaded_files:
        return JsonResponse({"error": "Missing file upload field: file"}, status=400)

    all_parsed_rows = []
    files_processed = 0
    preview_only = _is_truthy(request.POST.get("preview_only"))

    for uploaded_file in uploaded_files:
        file_text = uploaded_file.read().decode("utf-8-sig")
        parsed_rows = parse_activities_csv_text(file_text, user_id=user_id)
        if not parsed_rows:
            continue
        all_parsed_rows.extend(parsed_rows)
        files_processed += 1

    if not all_parsed_rows:
        return JsonResponse({"error": "No ACB eligible trade or distribution rows found in uploaded CSV file(s)"}, status=400)

    if preview_only:
        return JsonResponse({"parsed": len(all_parsed_rows), "rows": all_parsed_rows, "files": files_processed, "imported": 0})

    summary = _import_transactions_rows(all_parsed_rows, user_id)
    return JsonResponse({
        "parsed": summary.get("parsed", len(all_parsed_rows)),
        "inserted": summary.get("inserted", 0),
        "imported": summary.get("inserted", 0),
        "skipped": len(all_parsed_rows) - summary.get("inserted", 0),
        "files": files_processed,
    })


@require_http_methods(["POST"])
def import_holdings_csv(request):
    user_id = request.user.id
    uploaded_files = []
    seen_file_ids = set()
    for key in ("file", "files"):
        for f in request.FILES.getlist(key):
            if f and f.name and id(f) not in seen_file_ids:
                seen_file_ids.add(id(f))
                uploaded_files.append(f)

    if not uploaded_files:
        return JsonResponse({"error": "Missing file upload field: file"}, status=400)

    total_parsed = 0
    total_inserted = 0
    total_updated = 0
    preview_rows = []
    preview_only = _is_truthy(request.POST.get("preview_only"))
    raw_overwrite = request.POST.get("overwrite")
    should_overwrite = _is_truthy(raw_overwrite) if raw_overwrite is not None else True
    last_as_of = None
    all_parsed_files = []

    for uploaded_file in uploaded_files:
        file_text = uploaded_file.read().decode("utf-8-sig")
        parsed_rows = parse_holdings_csv_text(file_text, filename=uploaded_file.name)
        if not parsed_rows:
            continue
        all_parsed_files.append((parsed_rows, uploaded_file.name))
        total_parsed += len(parsed_rows)
        if preview_only:
            preview_rows.extend(parsed_rows)

    if total_parsed == 0:
        return JsonResponse({"error": "No holdings rows found in uploaded CSV file(s)"}, status=400)

    if preview_only:
        return JsonResponse({"parsed": total_parsed, "rows": preview_rows, "imported": 0, "files": len(uploaded_files)})

    with transaction.atomic():
        if should_overwrite:
            HoldingSnapshot.objects.filter(user_id=user_id).delete()

        for parsed_rows, filename in all_parsed_files:
            summary = _import_holdings_rows(parsed_rows, filename, user_id)
            total_inserted += int(summary.get("inserted") or 0)
            total_updated += int(summary.get("updated") or 0)
            if summary.get("as_of"):
                last_as_of = summary["as_of"]

    return JsonResponse({
        "parsed": total_parsed,
        "inserted": total_inserted,
        "updated": total_updated,
        "imported": total_inserted + total_updated,
        "as_of": last_as_of,
        "overwritten": should_overwrite,
        "files": len(uploaded_files),
    })


@require_http_methods(["POST"])
def import_rogers_credit_csv(request):
    user_id = request.user.id
    uploaded_files = []
    seen_file_ids = set()
    for key in ("file", "files"):
        for f in request.FILES.getlist(key):
            if f and f.name and id(f) not in seen_file_ids:
                seen_file_ids.add(id(f))
                uploaded_files.append(f)

    if not uploaded_files:
        return JsonResponse({"error": "Missing file upload field: file"}, status=400)

    card_label = str(request.POST.get("card_label") or "").strip() or None
    raw_provider = str(request.POST.get("provider") or "").strip().lower()

    # Determine bank provider if not explicitly given
    provider = raw_provider
    if not provider or provider in {"auto", "detect"}:
        if "wealthsimple" in request.path.lower():
            provider = "wealthsimple"
        elif card_label:
            acc = CreditCardAccount.objects.filter(user_id=user_id, label=card_label).first()
            if acc and acc.provider in {"rogers", "rogers_bank", "wealthsimple", "ws"}:
                if "wealthsimple" in acc.provider or "ws" in acc.provider:
                    provider = "wealthsimple"
                else:
                    provider = "rogers"
            elif "wealthsimple" in card_label.lower():
                provider = "wealthsimple"
            elif "roger" in card_label.lower():
                provider = "rogers"
            else:
                provider = "auto"
        else:
            provider = "auto"
    elif provider not in {"rogers", "rogers_bank", "wealthsimple", "ws", "auto"}:
        return JsonResponse({"error": "Missing or invalid bank. Choose 'rogers' or 'wealthsimple'."}, status=400)

    # Build historical merchant category lookup from the user's existing transactions
    user_category_map = get_user_merchant_category_map(user_id)

    total_parsed = 0
    total_inserted = 0
    total_skipped = 0
    files_processed = 0
    preview_rows = []
    preview_only = _is_truthy(request.POST.get("preview_only"))

    for uploaded_file in uploaded_files:
        file_text = uploaded_file.read().decode("utf-8-sig")
        file_provider = provider
        if not file_provider or file_provider in {"auto", "detect"}:
            file_provider = detect_credit_card_provider(file_text)

        try:
            parsed_rows = parse_credit_csv_text(
                file_text,
                provider=file_provider,
                card_label=card_label,
                user_category_map=user_category_map,
            )
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)
        if not parsed_rows:
            continue

        if preview_only:
            total_parsed += len(parsed_rows)
            files_processed += 1
            preview_rows.extend(parsed_rows)
            continue

        summary = _import_rogers_credit_rows(parsed_rows, uploaded_file.name, user_id)
        total_parsed += int(summary.get("parsed") or 0)
        total_inserted += int(summary.get("inserted") or 0)
        total_skipped += int(summary.get("skipped") or 0)
        files_processed += 1

    if total_parsed == 0:
        return JsonResponse({"error": "No credit card rows found in uploaded CSV file(s)"}, status=400)

    if preview_only:
        return JsonResponse({"parsed": total_parsed, "rows": preview_rows, "files": files_processed, "imported": 0})

    return JsonResponse({
        "parsed": total_parsed,
        "inserted": total_inserted,
        "skipped": total_skipped,
        "files": files_processed,
        "imported": total_inserted,
        "imported_count": total_inserted,
    })


@require_http_methods(["POST"])
def import_chequing_courant_csv(request):
    user_id = request.user.id
    uploaded_files = []
    seen_file_ids = set()
    for key in ("file", "files"):
        for f in request.FILES.getlist(key):
            if f and f.name and id(f) not in seen_file_ids:
                seen_file_ids.add(id(f))
                uploaded_files.append(f)

    if not uploaded_files:
        return JsonResponse({"error": "Missing file upload field: file"}, status=400)

    account_label = str(request.POST.get("account_label") or "").strip() or None
    total_parsed = 0
    total_inserted = 0
    total_skipped = 0
    files_processed = 0
    preview_rows = []
    preview_only = _is_truthy(request.POST.get("preview_only"))

    for uploaded_file in uploaded_files:
        file_text = uploaded_file.read().decode("utf-8-sig")
        parsed_rows = parse_chequing_courant_csv_text(file_text, account_label=account_label)
        if not parsed_rows:
            continue

        if preview_only:
            total_parsed += len(parsed_rows)
            files_processed += 1
            preview_rows.extend(parsed_rows)
            continue

        summary = _import_chequing_rows(parsed_rows, uploaded_file.name, user_id)
        total_parsed += int(summary.get("parsed") or 0)
        total_inserted += int(summary.get("inserted") or 0)
        total_skipped += int(summary.get("skipped") or 0)
        files_processed += 1

    if total_parsed == 0:
        return JsonResponse({"error": "No chequing rows found in uploaded CSV file(s)"}, status=400)

    if preview_only:
        return JsonResponse({"parsed": total_parsed, "rows": preview_rows, "files": files_processed, "imported": 0})

    return JsonResponse({
        "parsed": total_parsed,
        "inserted": total_inserted,
        "skipped": total_skipped,
        "files": files_processed,
        "imported": total_inserted,
        "imported_count": total_inserted,
    })


@require_http_methods(["POST"])
def create_import_review(request):
    user_id = request.user.id
    uploaded_files = []
    seen_file_ids = set()
    for key in ("file", "files"):
        for f in request.FILES.getlist(key):
            if f and f.name and id(f) not in seen_file_ids:
                seen_file_ids.add(id(f))
                uploaded_files.append(f)

    if not uploaded_files:
        return JsonResponse({"error": "Missing file upload field: file"}, status=400)

    import_type = str(request.POST.get("import_type") or request.POST.get("source_type") or "auto").strip()
    if import_type and import_type not in SUPPORTED_IMPORT_TYPES and import_type != "auto":
        return JsonResponse({"error": "Unsupported import_type"}, status=400)

    all_rows = []
    for file_idx, uploaded_file in enumerate(uploaded_files, start=1):
        ext = Path(uploaded_file.name or "").suffix.lower()
        if import_type == "tax_pdf":
            resolved_type = "tax_pdf"
        elif import_type == "activities_csv":
            resolved_type = "activities_csv"
        elif ext == ".pdf":
            resolved_type = "tax_pdf"
        elif ext == ".csv":
            resolved_type = "activities_csv"
        else:
            resolved_type = "activities_csv"

        file_bytes = uploaded_file.read()
        try:
            file_rows = parse_upload(resolved_type, uploaded_file.name, file_bytes, user_id=user_id)
        except Exception as exc:
            return JsonResponse({"error": f"Failed to parse import file '{uploaded_file.name}': {exc}"}, status=400)

        for r in file_rows:
            r["source_filename"] = uploaded_file.name
            r["file_index"] = file_idx
            all_rows.append(r)

    if not all_rows:
        return JsonResponse({"error": "No importable transactions found in file(s)"}, status=400)

    annotated_rows, stats = _evaluate_import_rows_deduplication(all_rows, user_id)
    warnings = _build_transaction_duplicate_warnings(stats=stats)

    if _is_truthy(request.POST.get("preview_only")):
        return JsonResponse(
            {
                "rows": annotated_rows,
                "parsed": len(annotated_rows),
                "new_rows": stats["new_rows"],
                "duplicate_in_upload": stats["duplicate_in_upload"],
                "already_in_ledger": stats["already_in_ledger"],
                "warnings": warnings,
                "files_count": len(uploaded_files),
            }
        )

    if len(uploaded_files) == 1:
        source_filename = uploaded_files[0].name
    else:
        filenames = [f.name for f in uploaded_files]
        source_filename = f"{len(uploaded_files)} files: {', '.join(filenames)}"
    if len(source_filename) > 250:
        source_filename = source_filename[:247] + "..."

    batch_id = _create_import_batch(import_type, source_filename, annotated_rows, user_id)
    batch_data = _get_batch(batch_id, user_id)
    batch_data["batch_id"] = batch_id
    batch_data["parsed"] = len(annotated_rows)
    batch_data["new_rows"] = stats["new_rows"]
    batch_data["duplicate_in_upload"] = stats["duplicate_in_upload"]
    batch_data["already_in_ledger"] = stats["already_in_ledger"]
    batch_data["duplicate_groups"] = stats["duplicate_in_upload"] + stats["already_in_ledger"]
    batch_data["duplicate_rows"] = stats["duplicate_in_upload"] + stats["already_in_ledger"]
    batch_data["warnings"] = warnings
    batch_data["files_count"] = len(uploaded_files)
    return JsonResponse(batch_data, status=201)


@require_GET
def get_import_review(request, batch_id):
    user_id = request.user.id
    batch_data = _get_batch(batch_id, user_id)
    if not batch_data:
        return JsonResponse({"error": "Import batch not found"}, status=404)
    return JsonResponse(batch_data)


@require_http_methods(["PUT"])
def update_import_review_row(request, batch_id, row_id):
    user_id = request.user.id
    try:
        payload = _read_json(request)
    except Exception:
        payload = {}

    try:
        ok = _update_batch_row(batch_id, row_id, payload, user_id)
    except Exception as exc:
        return JsonResponse({"error": f"Invalid row data: {exc}"}, status=400)

    if not ok:
        return JsonResponse({"error": "Import row not found"}, status=404)
    return JsonResponse({"updated": 1})


@require_http_methods(["PUT", "DELETE"])
def import_review_row_item(request, batch_id, row_id):
    if request.method == "PUT":
        return update_import_review_row(request, batch_id, row_id)
    return delete_import_review_row(request, batch_id, row_id)


@require_http_methods(["DELETE"])
def delete_import_review_row(request, batch_id, row_id):
    user_id = request.user.id
    ok = _delete_batch_row(batch_id, row_id, user_id)
    if not ok:
        return JsonResponse({"error": "Import row not found"}, status=404)
    return JsonResponse({"deleted": 1})


@require_http_methods(["POST"])
def commit_import_review(request, batch_id=None):
    user_id = request.user.id
    if batch_id is None:
        try:
            payload = _read_json(request)
            batch_id = int(payload.get("batch_id") or 0)
        except Exception:
            batch_id = None
    if not batch_id:
        return JsonResponse({"error": "batch_id is required"}, status=400)

    summary = _commit_batch(batch_id, user_id)
    if summary is None:
        return JsonResponse({"error": "Import batch not found"}, status=404)
    return JsonResponse(summary)


@require_http_methods(["POST"])
def commit_batch_endpoint(request, batch_id):
    return commit_import_review(request, batch_id)


@require_GET
def download_template(request, template_type):
    templates = {
        "transactions": {
            "filename": "transactions_template.csv",
            "content": """effective_date,effective_time,settlement_date,account_id,account_type,activity_type,activity_sub_type,description,direction,symbol,name,currency,quantity,unit_price,commission,net_cash_amount
2026-01-05,00:00:00,,ACT12345678,Non-registered,NonCashDistribution,-,XEQT: Non-cash Distribution (Adjusted Cost Base Entry Only) of $150.00 (executed at 2026-01-05),LONG,XEQT,iShares Core Equity ETF Portfolio,CAD,150.00,,,150.00
2026-01-05,00:00:00,,ACT12345678,Non-registered,ReturnOfCapital,-,XEQT: Return of Capital (Adjusted Cost Base Entry Only) of $-6.50 (executed at 2026-01-05),LONG,XEQT,iShares Core Equity ETF Portfolio,CAD,-6.50,,,-6.50
2026-01-06,12:33:17,2026-01-07,ACT12345678,Non-registered,Trade,BUY,XEQT - iShares Core Equity ETF Portfolio: Bought 10 shares at $40.00 per share (executed at 2026-01-06),LONG,XEQT,iShares Core Equity ETF Portfolio,CAD,10,40.00,0,-400.00
2026-03-31,15:47:06,2026-04-01,ACT12345678,Non-registered,Trade,SELL,XEQT - iShares Core Equity ETF Portfolio: Sold 5 shares at $45.00 per share (executed at 2026-03-31),LONG,XEQT,iShares Core Equity ETF Portfolio,CAD,-5,45.00,0,225.00""",
        },
        "holdings": {
            "filename": "holdings_template.csv",
            "content": """Symbol,Account Number,Account Name,Account Type,Account Classification,Quantity,Market Price,Market Price Currency,Book Value (CAD),Market Value,Market Value Currency,Market Unrealized Returns,Exchange,MIC,Name,Security Type
AAPL,12345678,My TFSA,TFSA,Tax Advantaged,10,150.00,USD,1200.00,1500.00,CAD,300.00,NASDAQ,XNAS,Apple Inc,Stock
VDY,12345678,My TFSA,TFSA,Tax Advantaged,50,35.00,CAD,1600.00,1750.00,CAD,150.00,TSX,XTSE,Vanguard FTSE Canadian High Dividend Yield Index ETF,ETF""",
        },
        "credit-card": {
            "filename": "credit_card_template.csv",
            "content": """Transaction Date,Posted Date,Description,Amount,Category
2024-01-15,2024-01-16,GROCERY STORE,-125.50,Groceries
2024-01-20,2024-01-21,GAS STATION,-60.00,Gas
2024-02-01,2024-02-02,RESTAURANT,-45.00,Dining
2024-02-10,2024-02-11,ONLINE SHOPPING,-89.99,Shopping""",
        },
        "chequing": {
            "filename": "chequing_template.csv",
            "content": """transaction_date,transaction_time,account_number,account_type,transaction_type,transaction_sub_type,status,payee,payee_email,amount,currency,notes
4/12/2026,4:00:00,10000001,Chequing,Withdrawal,E Transfer,Completed,Family Member,family@example.com,-150,CAD,
4/17/2026,22:34:50,10000001,Chequing,Withdrawal,Aft,Completed,UTILITY CORP,,-120.50,CAD,
4/18/2026,17:15:02,10000001,Chequing,Deposit,E Transfer,Completed,Jane Doe,jane.doe@example.com,75,CAD,
4/21/2026,9:57:28,10000001,Chequing,Deposit,Aft,Completed,EMPLOYER PAYROLL,,2500.00,CAD,
5/1/2026,0:00:00,10000001,Chequing,Interest,,Completed,,,5.00,CAD,
5/5/2026,9:58:25,10000001,Chequing,Internal Transfer,Source,Completed,,,-1000,CAD,
7/4/2026,23:23:09,10000001,Chequing,Internal Transfer,Destination,Completed,,,5000,CAD,""",
        },
    }

    template = templates.get(template_type)
    if not template:
        return JsonResponse({"error": "Template not found"}, status=404)

    response = HttpResponse(template["content"], content_type="text/csv")
    response["Content-Disposition"] = f"attachment; filename={template['filename']}"
    return response


def _read_json(request):
    try:
        if not request.body:
            return {}
        import json

        return json.loads(request.body.decode("utf-8"))
    except Exception:
        return {}


# Export Views

def _export_to_csv(headers, rows):
    """Helper function to generate CSV content from headers and rows."""
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue()


@require_GET
def export_transactions(request):
    """Export all ACB transactions to CSV."""
    user_id = request.user.id
    transactions = Transaction.objects.filter(user_id=user_id).order_by("trade_date", "id").values(
        "security", "trade_date", "transaction_type", "amount", "shares",
        "amount_per_share", "commission", "memo", "source", "created_at"
    )

    headers = [
        "Security", "Trade Date", "Transaction Type", "Amount", "Shares",
        "Amount Per Share", "Commission", "Memo", "Source", "Created At"
    ]

    rows = [
        [
            tx["security"],
            tx["trade_date"].strftime("%Y-%m-%d") if tx["trade_date"] else "",
            tx["transaction_type"],
            str(tx["amount"]),
            str(tx["shares"]),
            str(tx["amount_per_share"]) if tx["amount_per_share"] else "",
            str(tx["commission"]),
            tx["memo"] or "",
            tx["source"],
            tx["created_at"].strftime("%Y-%m-%d %H:%M:%S") if tx["created_at"] else "",
        ]
        for tx in transactions
    ]

    csv_content = _export_to_csv(headers, rows)
    response = HttpResponse(csv_content, content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="transactions_{datetime.now().strftime("%Y%m%d")}.csv"'
    return response


@require_GET
def export_holdings(request):
    """Export all holdings snapshots to CSV."""
    user_id = request.user.id
    holdings = HoldingSnapshot.objects.filter(user_id=user_id).order_by("as_of", "account_number", "symbol").values(
        "as_of", "account_name", "account_type", "account_classification", "account_number",
        "symbol", "exchange", "mic", "security_name", "security_type", "quantity",
        "market_price", "market_price_currency", "book_value_cad", "market_value",
        "market_value_currency", "unrealized_return", "source_filename", "imported_at"
    )

    headers = [
        "As Of", "Account Name", "Account Type", "Account Classification", "Account Number",
        "Symbol", "Exchange", "MIC", "Security Name", "Security Type", "Quantity",
        "Market Price", "Market Price Currency", "Book Value (CAD)", "Market Value",
        "Market Value Currency", "Unrealized Return", "Source Filename", "Imported At"
    ]

    rows = [
        [
            h["as_of"].strftime("%Y-%m-%d") if h["as_of"] else "",
            h["account_name"],
            h["account_type"] or "",
            h["account_classification"] or "",
            h["account_number"],
            h["symbol"],
            h["exchange"] or "",
            h["mic"] or "",
            h["security_name"] or "",
            h["security_type"] or "",
            str(h["quantity"]),
            str(h["market_price"]),
            h["market_price_currency"] or "",
            str(h["book_value_cad"]),
            str(h["market_value"]),
            h["market_value_currency"] or "",
            str(h["unrealized_return"]),
            h["source_filename"] or "",
            h["imported_at"].strftime("%Y-%m-%d %H:%M:%S") if h["imported_at"] else "",
        ]
        for h in holdings
    ]

    csv_content = _export_to_csv(headers, rows)
    response = HttpResponse(csv_content, content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="holdings_{datetime.now().strftime("%Y%m%d")}.csv"'
    return response


@require_GET
def export_net_worth(request):
    """Export all net worth history to CSV."""
    from core.models import NetWorthHistory

    user_id = request.user.id
    net_worth_data = NetWorthHistory.objects.filter(user_id=user_id).order_by("entry_date").values(
        "entry_date", "amount", "note", "created_at", "updated_at"
    )

    headers = ["Entry Date", "Amount", "Note", "Created At", "Updated At"]

    rows = [
        [
            nw["entry_date"].strftime("%Y-%m-%d") if nw["entry_date"] else "",
            str(nw["amount"]),
            nw["note"] or "",
            nw["created_at"].strftime("%Y-%m-%d %H:%M:%S") if nw["created_at"] else "",
            nw["updated_at"].strftime("%Y-%m-%d %H:%M:%S") if nw["updated_at"] else "",
        ]
        for nw in net_worth_data
    ]

    csv_content = _export_to_csv(headers, rows)
    response = HttpResponse(csv_content, content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="net_worth_{datetime.now().strftime("%Y%m%d")}.csv"'
    return response


@require_GET
def export_credit_cards(request):
    """Export all credit card transactions to CSV."""
    user_id = request.user.id
    cc_transactions = CreditCardTransaction.objects.filter(user_id=user_id).order_by("transaction_date", "id").values(
        "provider", "transaction_date", "posted_date", "reference_number", "activity_type",
        "status", "card_last4", "card_label", "merchant_category", "merchant_name",
        "merchant_city", "merchant_region", "merchant_country", "merchant_postal",
        "amount", "rewards", "is_hidden", "cardholder_name", "source_filename", "imported_at"
    )

    headers = [
        "Provider", "Transaction Date", "Posted Date", "Reference Number", "Activity Type",
        "Status", "Card Last 4", "Card Label", "Merchant Category", "Merchant Name",
        "Merchant City", "Merchant Region", "Merchant Country", "Merchant Postal",
        "Amount", "Rewards", "Is Hidden", "Cardholder Name", "Source Filename", "Imported At"
    ]

    rows = [
        [
            cc["provider"],
            cc["transaction_date"].strftime("%Y-%m-%d") if cc["transaction_date"] else "",
            cc["posted_date"].strftime("%Y-%m-%d") if cc["posted_date"] else "",
            cc["reference_number"] or "",
            cc["activity_type"] or "",
            cc["status"] or "",
            cc["card_last4"] or "",
            cc["card_label"] or "",
            cc["merchant_category"] or "",
            cc["merchant_name"] or "",
            cc["merchant_city"] or "",
            cc["merchant_region"] or "",
            cc["merchant_country"] or "",
            cc["merchant_postal"] or "",
            str(cc["amount"]),
            str(cc["rewards"]),
            str(cc["is_hidden"]),
            cc["cardholder_name"] or "",
            cc["source_filename"] or "",
            cc["imported_at"].strftime("%Y-%m-%d %H:%M:%S") if cc["imported_at"] else "",
        ]
        for cc in cc_transactions
    ]

    csv_content = _export_to_csv(headers, rows)
    response = HttpResponse(csv_content, content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="credit_cards_{datetime.now().strftime("%Y%m%d")}.csv"'
    return response


@require_GET
def export_chequing(request):
    """Export all chequing transactions to CSV."""
    user_id = request.user.id
    rows_query = ChequingTransaction.objects.filter(user_id=user_id).order_by("transaction_date", "id").values(
        "account_label", "transaction_date", "transaction_code", "description", "category",
        "amount", "balance", "currency", "is_hidden", "source_filename", "imported_at"
    )

    headers = [
        "Account Label", "Transaction Date", "Transaction Code", "Description", "Category",
        "Amount", "Balance", "Currency", "Is Hidden", "Source Filename", "Imported At"
    ]

    rows = [
        [
            row["account_label"] or "",
            row["transaction_date"].strftime("%Y-%m-%d") if row["transaction_date"] else "",
            row["transaction_code"] or "",
            row["description"] or "",
            row["category"] or "",
            str(row["amount"]),
            str(row["balance"]) if row["balance"] is not None else "",
            row["currency"] or "",
            str(row["is_hidden"]),
            row["source_filename"] or "",
            row["imported_at"].strftime("%Y-%m-%d %H:%M:%S") if row["imported_at"] else "",
        ]
        for row in rows_query
    ]

    csv_content = _export_to_csv(headers, rows)
    response = HttpResponse(csv_content, content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="chequing_{datetime.now().strftime("%Y%m%d")}.csv"'
    return response


@require_GET
def export_tfsa(request):
    """Export all TFSA data to CSV."""
    from core.models import TfsaAccount, TfsaAnnualLimit, TfsaContribution

    user_id = request.user.id

    # Get all TFSA data
    accounts = list(TfsaAccount.objects.filter(user_id=user_id).values(
        "id", "account_name", "account_number", "opening_balance", "created_at"
    ))

    limits = list(TfsaAnnualLimit.objects.filter(user_id=user_id).order_by("year").values(
        "year", "annual_limit", "created_at", "updated_at"
    ))

    contributions = list(TfsaContribution.objects.filter(user_id=user_id).order_by("contribution_date", "id").values(
        "tfsa_account_id", "contribution_date", "amount", "contribution_type", "memo", "created_at"
    ))

    # Create account ID to name mapping
    account_map = {acc["id"]: acc["account_name"] for acc in accounts}

    # Build CSV with multiple sections
    output = StringIO()
    writer = csv.writer(output)

    # Accounts section
    writer.writerow(["=== TFSA Accounts ==="])
    writer.writerow(["Account Name", "Account Number", "Opening Balance", "Created At"])
    for acc in accounts:
        writer.writerow([
            acc["account_name"],
            acc["account_number"] or "",
            str(acc["opening_balance"]),
            acc["created_at"].strftime("%Y-%m-%d %H:%M:%S") if acc["created_at"] else "",
        ])

    writer.writerow([])  # Empty row

    # Annual Limits section
    writer.writerow(["=== TFSA Annual Limits ==="])
    writer.writerow(["Year", "Annual Limit", "Created At", "Updated At"])
    for limit in limits:
        writer.writerow([
            str(limit["year"]),
            str(limit["annual_limit"]),
            limit["created_at"].strftime("%Y-%m-%d %H:%M:%S") if limit["created_at"] else "",
            limit["updated_at"].strftime("%Y-%m-%d %H:%M:%S") if limit["updated_at"] else "",
        ])

    writer.writerow([])  # Empty row

    # Contributions section
    writer.writerow(["=== TFSA Contributions ==="])
    writer.writerow(["Account Name", "Contribution Date", "Amount", "Contribution Type", "Memo", "Created At"])
    for contrib in contributions:
        writer.writerow([
            account_map.get(contrib["tfsa_account_id"], "Unknown"),
            contrib["contribution_date"].strftime("%Y-%m-%d") if contrib["contribution_date"] else "",
            str(contrib["amount"]),
            contrib["contribution_type"],
            contrib["memo"] or "",
            contrib["created_at"].strftime("%Y-%m-%d %H:%M:%S") if contrib["created_at"] else "",
        ])

    csv_content = output.getvalue()
    response = HttpResponse(csv_content, content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="tfsa_{datetime.now().strftime("%Y%m%d")}.csv"'
    return response


@require_GET
def export_rrsp(request):
    """Export all RRSP data to CSV."""
    from core.models import RrspAccount, RrspAnnualLimit, RrspContribution

    user_id = request.user.id

    # Get all RRSP data
    accounts = list(RrspAccount.objects.filter(user_id=user_id).values(
        "id", "account_name", "account_number", "opening_balance", "created_at"
    ))

    limits = list(RrspAnnualLimit.objects.filter(user_id=user_id).order_by("year").values(
        "year", "annual_limit", "created_at", "updated_at"
    ))

    contributions = list(RrspContribution.objects.filter(user_id=user_id).order_by("contribution_date", "id").values(
        "rrsp_account_id", "contribution_date", "amount", "contribution_type",
        "is_unused", "deducted_tax_year", "memo", "created_at"
    ))

    # Create account ID to name mapping
    account_map = {acc["id"]: acc["account_name"] for acc in accounts}

    # Build CSV with multiple sections
    output = StringIO()
    writer = csv.writer(output)

    # Accounts section
    writer.writerow(["=== RRSP Accounts ==="])
    writer.writerow(["Account Name", "Account Number", "Opening Balance", "Created At"])
    for acc in accounts:
        writer.writerow([
            acc["account_name"],
            acc["account_number"] or "",
            str(acc["opening_balance"]),
            acc["created_at"].strftime("%Y-%m-%d %H:%M:%S") if acc["created_at"] else "",
        ])

    writer.writerow([])  # Empty row

    # Annual Limits section
    writer.writerow(["=== RRSP Annual Limits ==="])
    writer.writerow(["Year", "Annual Limit", "Created At", "Updated At"])
    for limit in limits:
        writer.writerow([
            str(limit["year"]),
            str(limit["annual_limit"]),
            limit["created_at"].strftime("%Y-%m-%d %H:%M:%S") if limit["created_at"] else "",
            limit["updated_at"].strftime("%Y-%m-%d %H:%M:%S") if limit["updated_at"] else "",
        ])

    writer.writerow([])  # Empty row

    # Contributions section
    writer.writerow(["=== RRSP Contributions ==="])
    writer.writerow(["Account Name", "Contribution Date", "Amount", "Contribution Type",
                     "Is Unused", "Deducted Tax Year", "Memo", "Created At"])
    for contrib in contributions:
        writer.writerow([
            account_map.get(contrib["rrsp_account_id"], "Unknown"),
            contrib["contribution_date"].strftime("%Y-%m-%d") if contrib["contribution_date"] else "",
            str(contrib["amount"]),
            contrib["contribution_type"],
            str(contrib["is_unused"]),
            str(contrib["deducted_tax_year"]) if contrib["deducted_tax_year"] else "",
            contrib["memo"] or "",
            contrib["created_at"].strftime("%Y-%m-%d %H:%M:%S") if contrib["created_at"] else "",
        ])

    csv_content = output.getvalue()
    response = HttpResponse(csv_content, content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="rrsp_{datetime.now().strftime("%Y%m%d")}.csv"'
    return response


@require_GET
def export_fhsa(request):
    """Export all FHSA data to CSV."""
    from core.models import FhsaAccount, FhsaContribution

    user_id = request.user.id

    # Get all FHSA data
    accounts = list(FhsaAccount.objects.filter(user_id=user_id).values(
        "id", "account_name", "account_number", "opening_balance", "created_at"
    ))

    contributions = list(FhsaContribution.objects.filter(user_id=user_id).order_by("contribution_date", "id").values(
        "fhsa_account_id", "contribution_date", "amount", "contribution_type",
        "is_qualifying_withdrawal", "memo", "created_at"
    ))

    # Create account ID to name mapping
    account_map = {acc["id"]: acc["account_name"] for acc in accounts}

    # Build CSV with multiple sections
    output = StringIO()
    writer = csv.writer(output)

    # Accounts section
    writer.writerow(["=== FHSA Accounts ==="])
    writer.writerow(["Account Name", "Account Number", "Opening Balance", "Created At"])
    for acc in accounts:
        writer.writerow([
            acc["account_name"],
            acc["account_number"] or "",
            str(acc["opening_balance"]),
            acc["created_at"].strftime("%Y-%m-%d %H:%M:%S") if acc["created_at"] else "",
        ])

    writer.writerow([])  # Empty row

    # Contributions section
    writer.writerow(["=== FHSA Contributions ==="])
    writer.writerow(["Account Name", "Contribution Date", "Amount", "Contribution Type",
                     "Is Qualifying Withdrawal", "Memo", "Created At"])
    for contrib in contributions:
        writer.writerow([
            account_map.get(contrib["fhsa_account_id"], "Unknown"),
            contrib["contribution_date"].strftime("%Y-%m-%d") if contrib["contribution_date"] else "",
            str(contrib["amount"]),
            contrib["contribution_type"],
            str(contrib["is_qualifying_withdrawal"]),
            contrib["memo"] or "",
            contrib["created_at"].strftime("%Y-%m-%d %H:%M:%S") if contrib["created_at"] else "",
        ])

    csv_content = output.getvalue()
    response = HttpResponse(csv_content, content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="fhsa_{datetime.now().strftime("%Y%m%d")}.csv"'
    return response


@require_GET
def export_all_data(request):
    """Export all data as a ZIP file containing multiple CSV files."""
    import zipfile
    from io import BytesIO
    from core.models import (
        ChequingAccount, ChequingTransaction, CreditCardAccount, NetWorthHistory, TfsaAccount, TfsaAnnualLimit, TfsaContribution,
        RrspAccount, RrspAnnualLimit, RrspContribution, FhsaAccount, FhsaContribution
    )

    user_id = request.user.id
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Create a ZIP file in memory
    zip_buffer = BytesIO()

    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # 1. Transactions
        transactions = Transaction.objects.filter(user_id=user_id).order_by("trade_date", "id").values(
            "security", "trade_date", "transaction_type", "amount", "shares",
            "amount_per_share", "commission", "memo", "source", "created_at"
        )
        headers = ["Security", "Trade Date", "Transaction Type", "Amount", "Shares",
                  "Amount Per Share", "Commission", "Memo", "Source", "Created At"]
        rows = [
            [tx["security"], tx["trade_date"].strftime("%Y-%m-%d") if tx["trade_date"] else "",
             tx["transaction_type"], str(tx["amount"]), str(tx["shares"]),
             str(tx["amount_per_share"]) if tx["amount_per_share"] else "", str(tx["commission"]),
             tx["memo"] or "", tx["source"],
             tx["created_at"].strftime("%Y-%m-%d %H:%M:%S") if tx["created_at"] else ""]
            for tx in transactions
        ]
        zip_file.writestr(f"transactions_{timestamp}.csv", _export_to_csv(headers, rows))

        # 2. Holdings
        holdings = HoldingSnapshot.objects.filter(user_id=user_id).order_by("as_of", "account_number", "symbol").values(
            "as_of", "account_name", "account_type", "account_classification", "account_number",
            "symbol", "exchange", "mic", "security_name", "security_type", "quantity",
            "market_price", "market_price_currency", "book_value_cad", "market_value",
            "market_value_currency", "unrealized_return", "source_filename", "imported_at"
        )
        headers = ["As Of", "Account Name", "Account Type", "Account Classification", "Account Number",
                  "Symbol", "Exchange", "MIC", "Security Name", "Security Type", "Quantity",
                  "Market Price", "Market Price Currency", "Book Value (CAD)", "Market Value",
                  "Market Value Currency", "Unrealized Return", "Source Filename", "Imported At"]
        rows = [
            [h["as_of"].strftime("%Y-%m-%d") if h["as_of"] else "", h["account_name"],
             h["account_type"] or "", h["account_classification"] or "", h["account_number"],
             h["symbol"], h["exchange"] or "", h["mic"] or "", h["security_name"] or "",
             h["security_type"] or "", str(h["quantity"]), str(h["market_price"]),
             h["market_price_currency"] or "", str(h["book_value_cad"]), str(h["market_value"]),
             h["market_value_currency"] or "", str(h["unrealized_return"]), h["source_filename"] or "",
             h["imported_at"].strftime("%Y-%m-%d %H:%M:%S") if h["imported_at"] else ""]
            for h in holdings
        ]
        zip_file.writestr(f"holdings_{timestamp}.csv", _export_to_csv(headers, rows))

        # 3. Net Worth
        net_worth_data = NetWorthHistory.objects.filter(user_id=user_id).order_by("entry_date").values(
            "entry_date", "amount", "note", "created_at", "updated_at"
        )
        headers = ["Entry Date", "Amount", "Note", "Created At", "Updated At"]
        rows = [
            [nw["entry_date"].strftime("%Y-%m-%d") if nw["entry_date"] else "", str(nw["amount"]),
             nw["note"] or "", nw["created_at"].strftime("%Y-%m-%d %H:%M:%S") if nw["created_at"] else "",
             nw["updated_at"].strftime("%Y-%m-%d %H:%M:%S") if nw["updated_at"] else ""]
            for nw in net_worth_data
        ]
        zip_file.writestr(f"net_worth_{timestamp}.csv", _export_to_csv(headers, rows))

        # 4. Credit Cards
        cc_transactions = CreditCardTransaction.objects.filter(user_id=user_id).order_by("transaction_date", "id").values(
            "provider", "transaction_date", "posted_date", "reference_number", "activity_type",
            "status", "card_last4", "card_label", "merchant_category", "merchant_name",
            "merchant_city", "merchant_region", "merchant_country", "merchant_postal",
            "amount", "rewards", "is_hidden", "cardholder_name", "source_filename", "imported_at"
        )
        headers = ["Provider", "Transaction Date", "Posted Date", "Reference Number", "Activity Type",
                  "Status", "Card Last 4", "Card Label", "Merchant Category", "Merchant Name",
                  "Merchant City", "Merchant Region", "Merchant Country", "Merchant Postal",
                  "Amount", "Rewards", "Is Hidden", "Cardholder Name", "Source Filename", "Imported At"]
        rows = [
            [cc["provider"], cc["transaction_date"].strftime("%Y-%m-%d") if cc["transaction_date"] else "",
             cc["posted_date"].strftime("%Y-%m-%d") if cc["posted_date"] else "", cc["reference_number"] or "",
             cc["activity_type"] or "", cc["status"] or "", cc["card_last4"] or "", cc["card_label"] or "",
             cc["merchant_category"] or "", cc["merchant_name"] or "", cc["merchant_city"] or "",
             cc["merchant_region"] or "", cc["merchant_country"] or "", cc["merchant_postal"] or "",
             str(cc["amount"]), str(cc["rewards"]), str(cc["is_hidden"]), cc["cardholder_name"] or "",
             cc["source_filename"] or "", cc["imported_at"].strftime("%Y-%m-%d %H:%M:%S") if cc["imported_at"] else ""]
            for cc in cc_transactions
        ]
        zip_file.writestr(f"credit_cards_{timestamp}.csv", _export_to_csv(headers, rows))

        # 4b. Credit card accounts
        cc_accounts = CreditCardAccount.objects.filter(user_id=user_id).order_by("label").values(
            "provider", "label", "created_at"
        )
        headers = ["Provider", "Label", "Created At"]
        rows = [
            [
                row["provider"] or "",
                row["label"] or "",
                row["created_at"].strftime("%Y-%m-%d %H:%M:%S") if row["created_at"] else "",
            ]
            for row in cc_accounts
        ]
        zip_file.writestr(f"credit_card_accounts_{timestamp}.csv", _export_to_csv(headers, rows))

        # 5. Chequing accounts
        chequing_accounts = ChequingAccount.objects.filter(user_id=user_id).order_by("label").values(
            "provider", "label", "created_at"
        )
        headers = ["Provider", "Label", "Created At"]
        rows = [
            [
                row["provider"] or CHEQUING_DEFAULT_PROVIDER,
                row["label"] or "",
                row["created_at"].strftime("%Y-%m-%d %H:%M:%S") if row["created_at"] else "",
            ]
            for row in chequing_accounts
        ]
        zip_file.writestr(f"chequing_accounts_{timestamp}.csv", _export_to_csv(headers, rows))

        # 6. Chequing transactions
        chequing_rows = ChequingTransaction.objects.filter(user_id=user_id).order_by("transaction_date", "id").values(
            "account_label", "transaction_date", "transaction_code", "description", "category",
            "amount", "balance", "currency", "is_hidden", "source_filename", "imported_at"
        )
        headers = [
            "Account Label", "Transaction Date", "Transaction Code", "Description", "Category",
            "Amount", "Balance", "Currency", "Is Hidden", "Source Filename", "Imported At"
        ]
        rows = [
            [
                row["account_label"] or "",
                row["transaction_date"].strftime("%Y-%m-%d") if row["transaction_date"] else "",
                row["transaction_code"] or "",
                row["description"] or "",
                row["category"] or "",
                str(row["amount"]),
                str(row["balance"]) if row["balance"] is not None else "",
                row["currency"] or "",
                str(row["is_hidden"]),
                row["source_filename"] or "",
                row["imported_at"].strftime("%Y-%m-%d %H:%M:%S") if row["imported_at"] else "",
            ]
            for row in chequing_rows
        ]
        zip_file.writestr(f"chequing_{timestamp}.csv", _export_to_csv(headers, rows))

        # 7-9. TFSA, RRSP, FHSA (simplified - just basic data)
        # 7. TFSA
        tfsa_contribs = TfsaContribution.objects.filter(user_id=user_id).select_related("tfsa_account").order_by("contribution_date").values(
            "tfsa_account__account_name", "contribution_date", "amount", "contribution_type", "memo"
        )
        headers = ["Account Name", "Contribution Date", "Amount", "Contribution Type", "Memo"]
        rows = [
            [tc["tfsa_account__account_name"], tc["contribution_date"].strftime("%Y-%m-%d") if tc["contribution_date"] else "",
             str(tc["amount"]), tc["contribution_type"], tc["memo"] or ""]
            for tc in tfsa_contribs
        ]
        zip_file.writestr(f"tfsa_contributions_{timestamp}.csv", _export_to_csv(headers, rows))

        # 8. RRSP
        rrsp_contribs = RrspContribution.objects.filter(user_id=user_id).select_related("rrsp_account").order_by("contribution_date").values(
            "rrsp_account__account_name", "contribution_date", "amount", "contribution_type",
            "is_unused", "deducted_tax_year", "memo"
        )
        headers = ["Account Name", "Contribution Date", "Amount", "Contribution Type", "Is Unused", "Deducted Tax Year", "Memo"]
        rows = [
            [rc["rrsp_account__account_name"], rc["contribution_date"].strftime("%Y-%m-%d") if rc["contribution_date"] else "",
             str(rc["amount"]), rc["contribution_type"], str(rc["is_unused"]),
             str(rc["deducted_tax_year"]) if rc["deducted_tax_year"] else "", rc["memo"] or ""]
            for rc in rrsp_contribs
        ]
        zip_file.writestr(f"rrsp_contributions_{timestamp}.csv", _export_to_csv(headers, rows))

        # 9. FHSA
        fhsa_contribs = FhsaContribution.objects.filter(user_id=user_id).select_related("fhsa_account").order_by("contribution_date").values(
            "fhsa_account__account_name", "contribution_date", "amount", "contribution_type",
            "is_qualifying_withdrawal", "memo"
        )
        headers = ["Account Name", "Contribution Date", "Amount", "Contribution Type", "Is Qualifying Withdrawal", "Memo"]
        rows = [
            [fc["fhsa_account__account_name"], fc["contribution_date"].strftime("%Y-%m-%d") if fc["contribution_date"] else "",
             str(fc["amount"]), fc["contribution_type"], str(fc["is_qualifying_withdrawal"]), fc["memo"] or ""]
            for fc in fhsa_contribs
        ]
        zip_file.writestr(f"fhsa_contributions_{timestamp}.csv", _export_to_csv(headers, rows))

    # Prepare the response
    zip_buffer.seek(0)
    response = HttpResponse(zip_buffer.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="finglass_export_{timestamp}.zip"'
    return response


# Full Data Import (Restore)

def _import_csv_to_model(csv_content, model_class, field_mapping, user_id, unique_fields=None, account_mapping=None):
    """
    Generic helper to import CSV data into a Django model.

    Args:
        csv_content: CSV text content
        model_class: Django model class to import into
        field_mapping: Dict mapping CSV headers to model field names
        user_id: User ID for the import
        unique_fields: List of fields to check for uniqueness (for update_or_create)
        account_mapping: Dict mapping account names to account IDs (for related models)

    Returns:
        Dict with counts of inserted and updated records
    """
    reader = csv.DictReader(StringIO(csv_content))
    inserted = 0
    updated = 0
    errors = []

    for row_num, row in enumerate(reader, start=2):  # Start at 2 (header is row 1)
        try:
            # Build the data dict from field mapping
            data = {"user_id": user_id}
            lookup_fields = {}

            for csv_header, model_field in field_mapping.items():
                value = row.get(csv_header, "").strip()

                # Skip empty values for nullable fields
                if value == "":
                    continue

                # Handle special field transformations
                if model_field.endswith("_date") or model_field == "as_of":
                    # Parse date fields
                    if value:
                        data[model_field] = datetime.strptime(value.split()[0], "%Y-%m-%d").date()
                elif model_field.endswith("_at"):
                    # Skip auto-generated timestamp fields
                    continue
                elif model_field in ["amount", "shares", "commission", "quantity", "market_price",
                                     "book_value_cad", "market_value", "unrealized_return",
                                     "amount_per_share", "rewards", "annual_limit", "opening_balance", "balance"]:
                    # Numeric fields
                    data[model_field] = _to_decimal(value) if value else 0
                elif model_field == "is_hidden" or model_field == "is_unused" or model_field == "is_qualifying_withdrawal":
                    # Boolean fields
                    data[model_field] = value.lower() in ("true", "1", "yes")
                elif model_field == "year" or model_field == "deducted_tax_year":
                    # Integer fields
                    data[model_field] = int(value) if value else None
                elif model_field.endswith("_account_id"):
                    # Foreign key to account - use account_mapping
                    if account_mapping and value:
                        data[model_field] = account_mapping.get(value)
                else:
                    data[model_field] = value

                # Build lookup fields for unique constraint checking
                if unique_fields and model_field in unique_fields and model_field != "user_id":
                    lookup_fields[model_field] = data[model_field]

            # Create or update
            if unique_fields and lookup_fields:
                lookup_fields["user_id"] = user_id
                obj, created = model_class.objects.update_or_create(
                    **lookup_fields,
                    defaults={k: v for k, v in data.items() if k not in lookup_fields}
                )
                if created:
                    inserted += 1
                else:
                    updated += 1
            else:
                model_class.objects.create(**data)
                inserted += 1

        except Exception as e:
            errors.append(f"Row {row_num}: {str(e)}")
            if len(errors) > 10:  # Limit error reporting
                errors.append("... (additional errors truncated)")
                break

    return {"inserted": inserted, "updated": updated, "errors": errors}


@require_http_methods(["POST"])
def import_full_backup(request):
    """
    Import a full backup ZIP file containing all exported data.
    This is a complete restore operation.
    """
    from core.models import (
        ChequingAccount, ChequingTransaction, CreditCardAccount, NetWorthHistory, TfsaAccount, TfsaAnnualLimit, TfsaContribution,
        RrspAccount, RrspAnnualLimit, RrspContribution, FhsaAccount, FhsaContribution
    )

    user_id = request.user.id

    if "file" not in request.FILES:
        return JsonResponse({"error": "Missing file upload field: file"}, status=400)

    uploaded_file = request.FILES["file"]
    if not uploaded_file.name or not uploaded_file.name.endswith(".zip"):
        return JsonResponse({"error": "Please upload a ZIP file"}, status=400)

    clear_existing = request.POST.get("clear_existing", "false").lower() == "true"

    try:
        import zipfile

        # Read the ZIP file
        zip_bytes = uploaded_file.read()
        zip_buffer = BytesIO(zip_bytes)

        summary = {
            "transactions": {"inserted": 0, "updated": 0, "errors": []},
            "holdings": {"inserted": 0, "updated": 0, "errors": []},
            "net_worth": {"inserted": 0, "updated": 0, "errors": []},
            "credit_cards": {"inserted": 0, "updated": 0, "errors": []},
            "chequing": {"inserted": 0, "updated": 0, "errors": []},
            "tfsa": {"inserted": 0, "updated": 0, "errors": []},
            "rrsp": {"inserted": 0, "updated": 0, "errors": []},
            "fhsa": {"inserted": 0, "updated": 0, "errors": []},
        }

        # Clear existing data if requested
        if clear_existing:
            Transaction.objects.filter(user_id=user_id).delete()
            HoldingSnapshot.objects.filter(user_id=user_id).delete()
            NetWorthHistory.objects.filter(user_id=user_id).delete()
            CreditCardTransaction.objects.filter(user_id=user_id).delete()
            CreditCardAccount.objects.filter(user_id=user_id).delete()
            ChequingTransaction.objects.filter(user_id=user_id).delete()
            ChequingAccount.objects.filter(user_id=user_id).delete()
            TfsaContribution.objects.filter(user_id=user_id).delete()
            TfsaAnnualLimit.objects.filter(user_id=user_id).delete()
            TfsaAccount.objects.filter(user_id=user_id).delete()
            RrspContribution.objects.filter(user_id=user_id).delete()
            RrspAnnualLimit.objects.filter(user_id=user_id).delete()
            RrspAccount.objects.filter(user_id=user_id).delete()
            FhsaContribution.objects.filter(user_id=user_id).delete()
            FhsaAccount.objects.filter(user_id=user_id).delete()

        with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
            file_list = zip_file.namelist()

            # 1. Import Transactions
            tx_files = [f for f in file_list if f.startswith("transactions_") and f.endswith(".csv")]
            if tx_files:
                csv_content = zip_file.read(tx_files[0]).decode("utf-8")
                field_mapping = {
                    "Security": "security",
                    "Trade Date": "trade_date",
                    "Transaction Type": "transaction_type",
                    "Amount": "amount",
                    "Shares": "shares",
                    "Amount Per Share": "amount_per_share",
                    "Commission": "commission",
                    "Memo": "memo",
                    "Source": "source",
                }
                summary["transactions"] = _import_csv_to_model(
                    csv_content, Transaction, field_mapping, user_id
                )

            # 2. Import Holdings
            holdings_files = [f for f in file_list if f.startswith("holdings_") and f.endswith(".csv")]
            if holdings_files:
                csv_content = zip_file.read(holdings_files[0]).decode("utf-8")
                field_mapping = {
                    "As Of": "as_of",
                    "Account Name": "account_name",
                    "Account Type": "account_type",
                    "Account Classification": "account_classification",
                    "Account Number": "account_number",
                    "Symbol": "symbol",
                    "Exchange": "exchange",
                    "MIC": "mic",
                    "Security Name": "security_name",
                    "Security Type": "security_type",
                    "Quantity": "quantity",
                    "Market Price": "market_price",
                    "Market Price Currency": "market_price_currency",
                    "Book Value (CAD)": "book_value_cad",
                    "Market Value": "market_value",
                    "Market Value Currency": "market_value_currency",
                    "Unrealized Return": "unrealized_return",
                    "Source Filename": "source_filename",
                }
                summary["holdings"] = _import_csv_to_model(
                    csv_content, HoldingSnapshot, field_mapping, user_id,
                    unique_fields=["as_of", "account_number", "symbol"]
                )

            # 3. Import Net Worth
            nw_files = [f for f in file_list if f.startswith("net_worth_") and f.endswith(".csv")]
            if nw_files:
                csv_content = zip_file.read(nw_files[0]).decode("utf-8")
                field_mapping = {
                    "Entry Date": "entry_date",
                    "Amount": "amount",
                    "Note": "note",
                }
                summary["net_worth"] = _import_csv_to_model(
                    csv_content, NetWorthHistory, field_mapping, user_id,
                    unique_fields=["entry_date"]
                )

            # 4. Import Credit Cards
            credit_account_summary = None
            cc_account_files = [f for f in file_list if f.startswith("credit_card_accounts_") and f.endswith(".csv")]
            if cc_account_files:
                csv_content = zip_file.read(cc_account_files[0]).decode("utf-8")
                reader = csv.DictReader(StringIO(csv_content))
                inserted = 0
                updated = 0
                errors = []
                for row_num, row in enumerate(reader, start=2):
                    label = str(row.get("Label") or "").strip()
                    provider = _normalize_credit_card_provider_name(row.get("Provider"))
                    if not label:
                        continue
                    if not provider:
                        errors.append(f"Row {row_num}: Unsupported credit card bank '{row.get('Provider', '')}'. Supported banks: Rogers Bank, Wealthsimple")
                        if len(errors) > 10:
                            errors.append("... (additional errors truncated)")
                            break
                        continue

                    _, created = CreditCardAccount.objects.update_or_create(
                        user_id=user_id,
                        label=label,
                        defaults={"provider": provider},
                    )
                    if created:
                        inserted += 1
                    else:
                        updated += 1

                credit_account_summary = {"inserted": inserted, "updated": updated, "errors": errors}

            credit_tx_summary = None
            cc_files = [f for f in file_list if f.startswith("credit_cards_") and f.endswith(".csv")]
            if cc_files:
                csv_content = zip_file.read(cc_files[0]).decode("utf-8")
                field_mapping = {
                    "Provider": "provider",
                    "Transaction Date": "transaction_date",
                    "Posted Date": "posted_date",
                    "Reference Number": "reference_number",
                    "Activity Type": "activity_type",
                    "Status": "status",
                    "Card Last 4": "card_last4",
                    "Card Label": "card_label",
                    "Merchant Category": "merchant_category",
                    "Merchant Name": "merchant_name",
                    "Merchant City": "merchant_city",
                    "Merchant Region": "merchant_region",
                    "Merchant Country": "merchant_country",
                    "Merchant Postal": "merchant_postal",
                    "Amount": "amount",
                    "Rewards": "rewards",
                    "Is Hidden": "is_hidden",
                    "Cardholder Name": "cardholder_name",
                    "Source Filename": "source_filename",
                }
                credit_tx_summary = _import_csv_to_model(
                    csv_content, CreditCardTransaction, field_mapping, user_id
                )

                for row in CreditCardTransaction.objects.filter(user_id=user_id).values("card_label", "provider").distinct():
                    provider = _normalize_credit_card_provider_name(row.get("provider")) or str(row.get("provider") or "").strip()
                    label = str(row.get("card_label") or row.get("provider") or "").strip()
                    if not label or not provider:
                        continue
                    CreditCardAccount.objects.get_or_create(
                        user_id=user_id,
                        label=label,
                        defaults={"provider": provider},
                    )

            if credit_account_summary or credit_tx_summary:
                summary["credit_cards"] = {
                    "inserted": int((credit_account_summary or {}).get("inserted", 0)) + int((credit_tx_summary or {}).get("inserted", 0)),
                    "updated": int((credit_account_summary or {}).get("updated", 0)) + int((credit_tx_summary or {}).get("updated", 0)),
                    "errors": list((credit_account_summary or {}).get("errors", [])) + list((credit_tx_summary or {}).get("errors", [])),
                }

            # 5. Import Chequing accounts
            chequing_account_summary = None
            chequing_account_files = [f for f in file_list if f.startswith("chequing_accounts_") and f.endswith(".csv")]
            if chequing_account_files:
                csv_content = zip_file.read(chequing_account_files[0]).decode("utf-8")
                reader = csv.DictReader(StringIO(csv_content))
                inserted = 0
                updated = 0
                errors = []
                for row_num, row in enumerate(reader, start=2):
                    label = str(row.get("Label") or "").strip()
                    if not label:
                        continue

                    raw_provider = str(row.get("Provider") or "").strip()
                    if not raw_provider:
                        provider = CHEQUING_DEFAULT_PROVIDER
                    else:
                        provider = CHEQUING_SUPPORTED_PROVIDERS.get(raw_provider.lower())
                        if not provider:
                            supported = ", ".join(CHEQUING_SUPPORTED_PROVIDERS.values())
                            errors.append(f"Row {row_num}: Unsupported chequing bank '{raw_provider}'. Supported banks: {supported}")
                            if len(errors) > 10:
                                errors.append("... (additional errors truncated)")
                                break
                            continue

                    _, created = ChequingAccount.objects.update_or_create(
                        user_id=user_id,
                        label=label,
                        defaults={"provider": provider},
                    )
                    if created:
                        inserted += 1
                    else:
                        updated += 1

                chequing_account_summary = {"inserted": inserted, "updated": updated, "errors": errors}

            # 6. Import chequing transactions
            chequing_tx_summary = None
            chequing_files = [f for f in file_list if f.startswith("chequing_") and f.endswith(".csv")]
            if chequing_files:
                csv_content = zip_file.read(chequing_files[0]).decode("utf-8")
                field_mapping = {
                    "Account Label": "account_label",
                    "Transaction Date": "transaction_date",
                    "Transaction Code": "transaction_code",
                    "Description": "description",
                    "Category": "category",
                    "Amount": "amount",
                    "Balance": "balance",
                    "Currency": "currency",
                    "Is Hidden": "is_hidden",
                    "Source Filename": "source_filename",
                }
                chequing_tx_summary = _import_csv_to_model(
                    csv_content, ChequingTransaction, field_mapping, user_id
                )

                for label in (
                    ChequingTransaction.objects.filter(user_id=user_id)
                    .values_list("account_label", flat=True)
                    .distinct()
                ):
                    normalized = str(label or "").strip()
                    if not normalized:
                        continue
                    ChequingAccount.objects.get_or_create(
                        user_id=user_id,
                        label=normalized,
                        defaults={"provider": CHEQUING_DEFAULT_PROVIDER},
                    )

            if chequing_account_summary or chequing_tx_summary:
                summary["chequing"] = {
                    "inserted": int((chequing_account_summary or {}).get("inserted", 0)) + int((chequing_tx_summary or {}).get("inserted", 0)),
                    "updated": int((chequing_account_summary or {}).get("updated", 0)) + int((chequing_tx_summary or {}).get("updated", 0)),
                    "errors": list((chequing_account_summary or {}).get("errors", [])) + list((chequing_tx_summary or {}).get("errors", [])),
                }

            # 7. Import TFSA (simplified for now - just contributions)
            tfsa_files = [f for f in file_list if f.startswith("tfsa_contributions_") and f.endswith(".csv")]
            if tfsa_files:
                csv_content = zip_file.read(tfsa_files[0]).decode("utf-8")

                # First, ensure we have accounts created
                account_names = set()
                reader = csv.DictReader(StringIO(csv_content))
                for row in reader:
                    account_name = row.get("Account Name", "").strip()
                    if account_name:
                        account_names.add(account_name)

                # Create accounts if they don't exist
                account_mapping = {}
                for acc_name in account_names:
                    acc, _ = TfsaAccount.objects.get_or_create(
                        user_id=user_id,
                        account_name=acc_name,
                        defaults={"opening_balance": 0}
                    )
                    account_mapping[acc_name] = acc.id

                # Now import contributions
                field_mapping = {
                    "Account Name": "tfsa_account_id",
                    "Contribution Date": "contribution_date",
                    "Amount": "amount",
                    "Contribution Type": "contribution_type",
                    "Memo": "memo",
                }
                summary["tfsa"] = _import_csv_to_model(
                    csv_content, TfsaContribution, field_mapping, user_id,
                    account_mapping=account_mapping
                )

            # 7. Import RRSP
            rrsp_files = [f for f in file_list if f.startswith("rrsp_contributions_") and f.endswith(".csv")]
            if rrsp_files:
                csv_content = zip_file.read(rrsp_files[0]).decode("utf-8")

                # Create accounts
                account_names = set()
                reader = csv.DictReader(StringIO(csv_content))
                for row in reader:
                    account_name = row.get("Account Name", "").strip()
                    if account_name:
                        account_names.add(account_name)

                account_mapping = {}
                for acc_name in account_names:
                    acc, _ = RrspAccount.objects.get_or_create(
                        user_id=user_id,
                        account_name=acc_name,
                        defaults={"opening_balance": 0}
                    )
                    account_mapping[acc_name] = acc.id

                # Import contributions
                field_mapping = {
                    "Account Name": "rrsp_account_id",
                    "Contribution Date": "contribution_date",
                    "Amount": "amount",
                    "Contribution Type": "contribution_type",
                    "Is Unused": "is_unused",
                    "Deducted Tax Year": "deducted_tax_year",
                    "Memo": "memo",
                }
                summary["rrsp"] = _import_csv_to_model(
                    csv_content, RrspContribution, field_mapping, user_id,
                    account_mapping=account_mapping
                )

            # 8. Import FHSA
            fhsa_files = [f for f in file_list if f.startswith("fhsa_contributions_") and f.endswith(".csv")]
            if fhsa_files:
                csv_content = zip_file.read(fhsa_files[0]).decode("utf-8")

                # Create accounts
                account_names = set()
                reader = csv.DictReader(StringIO(csv_content))
                for row in reader:
                    account_name = row.get("Account Name", "").strip()
                    if account_name:
                        account_names.add(account_name)

                account_mapping = {}
                for acc_name in account_names:
                    acc, _ = FhsaAccount.objects.get_or_create(
                        user_id=user_id,
                        account_name=acc_name,
                        defaults={"opening_balance": 0}
                    )
                    account_mapping[acc_name] = acc.id

                # Import contributions
                field_mapping = {
                    "Account Name": "fhsa_account_id",
                    "Contribution Date": "contribution_date",
                    "Amount": "amount",
                    "Contribution Type": "contribution_type",
                    "Is Qualifying Withdrawal": "is_qualifying_withdrawal",
                    "Memo": "memo",
                }
                summary["fhsa"] = _import_csv_to_model(
                    csv_content, FhsaContribution, field_mapping, user_id,
                    account_mapping=account_mapping
                )

        # Calculate totals
        total_inserted = sum(s.get("inserted", 0) for s in summary.values())
        total_updated = sum(s.get("updated", 0) for s in summary.values())
        all_errors = []
        for domain, data in summary.items():
            if data.get("errors"):
                all_errors.extend([f"{domain}: {err}" for err in data["errors"][:3]])  # Limit errors per domain

        response_data = {
            "success": True,
            "cleared": clear_existing,
            "total_inserted": total_inserted,
            "total_updated": total_updated,
            "summary": summary,
        }

        if all_errors:
            response_data["warnings"] = all_errors[:10]  # Limit total warnings

        return JsonResponse(response_data)

    except zipfile.BadZipFile:
        return JsonResponse({"error": "Invalid ZIP file"}, status=400)
    except Exception as e:
        return JsonResponse({"error": f"Import failed: {str(e)}"}, status=500)
