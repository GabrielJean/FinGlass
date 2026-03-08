from decimal import Decimal, InvalidOperation


ZERO = Decimal("0")
EPSILON = Decimal("0.000000001")
MONEY_Q = Decimal("0.0001")
SHARES_Q = Decimal("0.000001")


def _to_decimal(value):
    if value in (None, ""):
        return ZERO
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return ZERO


def _rounded_float(value, quantum):
    return float(value.quantize(quantum))


def calculate_ledger_rows(rows):
    share_balance = ZERO
    acb = ZERO
    ledger = []

    for row in rows:
        tx_type = (row["transaction_type"] or "").strip().lower()
        amount = _to_decimal(row.get("amount"))
        shares = _to_decimal(row.get("shares"))
        commission = _to_decimal(row.get("commission"))
        capital_gain = ZERO

        if tx_type == "buy":
            share_balance += shares
            acb += amount + commission
        elif tx_type == "sell":
            if share_balance <= ZERO:
                raise ValueError(
                    f"Cannot sell shares with zero balance (row id={row.get('id')})"
                )
            if shares - share_balance > EPSILON:
                raise ValueError(
                    f"Selling more shares than owned (row id={row.get('id')})"
                )

            adjusted_cost = (acb / share_balance) * shares
            proceeds = amount - commission
            capital_gain = proceeds - adjusted_cost
            share_balance -= shares
            acb -= adjusted_cost

            if abs(share_balance) < EPSILON:
                share_balance = ZERO
                acb = ZERO
        elif tx_type == "return of capital":
            acb -= amount
            if acb < ZERO:
                capital_gain += -acb
                acb = ZERO
        elif tx_type == "capital gains dividend":
            acb += amount
        elif tx_type == "reinvested dividend":
            share_balance += shares
            acb += amount + commission
        elif tx_type == "reinvested capital gains distribution":
            acb += amount
            share_balance += shares
        elif tx_type == "split":
            if shares <= ZERO:
                raise ValueError(
                    f"Split ratio must be greater than zero (row id={row.get('id')})"
                )
            share_balance *= shares

        acb_per_share = acb / share_balance if share_balance > ZERO else ZERO

        ledger.append(
            {
                "id": row["id"],
                "security": row["security"],
                "trade_date": row["trade_date"],
                "transaction_type": row["transaction_type"],
                "amount": _rounded_float(amount, MONEY_Q),
                "shares": _rounded_float(shares, SHARES_Q),
                "commission": _rounded_float(commission, MONEY_Q),
                "memo": row["memo"],
                "source": row["source"],
                "share_balance": _rounded_float(share_balance, SHARES_Q),
                "acb": _rounded_float(acb, MONEY_Q),
                "acb_per_share": _rounded_float(acb_per_share, SHARES_Q),
                "capital_gain": _rounded_float(capital_gain, MONEY_Q),
            }
        )

    return ledger
