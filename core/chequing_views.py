import json
from collections import defaultdict

from django.db.models import Count
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_http_methods

from core.constants import CHEQUING_DEFAULT_PROVIDER, CHEQUING_SUPPORTED_PROVIDERS
from core.models import ChequingAccount, ChequingTransaction
from core.services.chequing_service import normalize_chequing_category, parse_bool_query


_INTERNAL_TRANSFER_OUT_CODES = {"TRFOUT", "TRFOUTTF"}
_INTERNAL_TRANSFER_OUT_CATEGORY = "Money Into Savings (to Savings/Investments)"
_INTERNAL_TRANSFER_IN_CODES = {"TRFINTF"}
_INTERNAL_TRANSFER_IN_CATEGORY = "Money Out of Savings (from Savings/Investments)"
_INTERNAL_TRANSFER_SAVINGS_INVESTING_HINTS = (
    "saving",
    "savings",
    "invest",
    "investment",
    "rrsp",
    "tfsa",
    "fhsa",
)


def _read_json(request):
    try:
        if not request.body:
            return {}
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}


def _tx_dict(row):
    amount = float(row.amount or 0)
    return {
        "id": row.id,
        "account_label": row.account_label,
        "transaction_date": row.transaction_date.isoformat() if row.transaction_date else "",
        "transaction_code": row.transaction_code or "",
        "description": row.description or "",
        "category": row.category or "Other",
        "amount": amount,
        "balance": float(row.balance) if row.balance is not None else None,
        "currency": row.currency or "CAD",
        "is_hidden": bool(row.is_hidden),
        "direction": "in" if amount > 0 else "out" if amount < 0 else "neutral",
    }


def _normalize_account_label(value):
    label = str(value or "").strip()
    return label[:128]


def _normalize_chequing_provider(value):
    raw = str(value or "").strip().lower()
    if not raw:
        return CHEQUING_DEFAULT_PROVIDER
    return CHEQUING_SUPPORTED_PROVIDERS.get(raw)


def _is_internal_transfer_to_savings_or_investing(row):
    code = str(row.get("transaction_code") or "").strip().upper()
    if code in _INTERNAL_TRANSFER_OUT_CODES:
        return True

    category = str(row.get("category") or "").strip()
    if category == _INTERNAL_TRANSFER_OUT_CATEGORY:
        return True

    description = str(row.get("description") or "").strip().lower()
    if not description:
        return False
    return any(token in description for token in _INTERNAL_TRANSFER_SAVINGS_INVESTING_HINTS)


def _is_internal_transfer_from_savings_or_investing(row):
    code = str(row.get("transaction_code") or "").strip().upper()
    if code in _INTERNAL_TRANSFER_IN_CODES:
        return True

    category = str(row.get("category") or "").strip()
    if category == _INTERNAL_TRANSFER_IN_CATEGORY:
        return True

    description = str(row.get("description") or "").strip().lower()
    if not description:
        return False
    return "transfer" in description and any(token in description for token in _INTERNAL_TRANSFER_SAVINGS_INVESTING_HINTS)


@require_http_methods(["GET", "DELETE"])
def chequing_transactions_collection(request):
    if request.method == "GET":
        return chequing_transactions(request)
    return delete_all_chequing_transactions(request)


@require_GET
def chequing_dashboard(request):
    start_date = str(request.GET.get("start_date") or "").strip()
    end_date = str(request.GET.get("end_date") or "").strip()
    category = str(request.GET.get("category") or "").strip()
    search = str(request.GET.get("search") or "").strip()
    account_label = str(request.GET.get("account_label") or "").strip()
    include_hidden = parse_bool_query(request.GET.get("include_hidden"))

    latest_transaction_date = (
        ChequingTransaction.objects.filter(user=request.user)
        .order_by("-transaction_date", "-id")
        .values_list("transaction_date", flat=True)
        .first()
    )

    queryset = ChequingTransaction.objects.filter(user=request.user)
    if start_date:
        queryset = queryset.filter(transaction_date__gte=start_date)
    if end_date:
        queryset = queryset.filter(transaction_date__lte=end_date)
    if category:
        queryset = queryset.filter(category=category)
    if account_label:
        queryset = queryset.filter(account_label=account_label)
    if search:
        queryset = queryset.filter(description__icontains=search)
    if not include_hidden:
        queryset = queryset.filter(is_hidden=False)

    rows = [_tx_dict(row) for row in queryset]

    inflow_rows = [row for row in rows if float(row.get("amount") or 0) > 0]
    external_inflow_rows = [
        row
        for row in inflow_rows
        if not _is_internal_transfer_from_savings_or_investing(row)
    ]
    outflow_rows = [row for row in rows if float(row.get("amount") or 0) < 0]
    spending_outflow_rows = [
        row
        for row in outflow_rows
        if not _is_internal_transfer_to_savings_or_investing(row)
    ]

    total_in = round(sum(float(row.get("amount") or 0) for row in external_inflow_rows), 2)
    total_out = round(abs(sum(float(row.get("amount") or 0) for row in spending_outflow_rows)), 2)
    net_flow = round(total_in - total_out, 2)

    summary = {
        "total_in": total_in,
        "total_out": total_out,
        "net_flow": net_flow,
        "transactions": len(rows),
        "inflow_transactions": len(external_inflow_rows),
        "outflow_transactions": len(spending_outflow_rows),
    }

    monthly_totals = defaultdict(lambda: {"in": 0.0, "out": 0.0, "internal_out": 0.0})
    for row in rows:
        month = str(row.get("transaction_date") or "")[:7]
        amount = float(row.get("amount") or 0)
        if not month:
            continue
        if amount >= 0:
            if _is_internal_transfer_from_savings_or_investing(row):
                continue
            monthly_totals[month]["in"] += amount
        else:
            if _is_internal_transfer_to_savings_or_investing(row):
                monthly_totals[month]["internal_out"] += abs(amount)
                continue
            monthly_totals[month]["out"] += abs(amount)

    monthly = []
    for month in sorted(monthly_totals.keys()):
        month_in = round(monthly_totals[month]["in"], 2)
        month_out = round(monthly_totals[month]["out"], 2)
        month_internal_out = round(monthly_totals[month]["internal_out"], 2)
        monthly.append(
            {
                "month": month,
                "in": month_in,
                "out": month_out,
                "internal_out": month_internal_out,
                "net": round(month_in - month_out, 2),
            }
        )

    category_totals = defaultdict(lambda: {"in": 0.0, "out": 0.0, "count": 0})
    for row in rows:
        amount = float(row.get("amount") or 0)
        name = str(row.get("category") or "Other").strip() or "Other"
        if amount >= 0:
            category_totals[name]["in"] += amount
        else:
            category_totals[name]["out"] += abs(amount)
        category_totals[name]["count"] += 1

    categories = []
    for name, totals in category_totals.items():
        category_in = round(totals["in"], 2)
        category_out = round(totals["out"], 2)
        categories.append(
            {
                "category": name,
                "total_in": category_in,
                "total_out": category_out,
                "net": round(category_in - category_out, 2),
                "count": totals["count"],
            }
        )

    categories.sort(key=lambda item: item.get("total_out", 0), reverse=True)

    months_count = len(monthly)
    avg_monthly_in = round(total_in / months_count, 2) if months_count else 0.0
    avg_monthly_out = round(total_out / months_count, 2) if months_count else 0.0
    positive_months = sum(1 for row in monthly if float(row.get("net") or 0) > 0)
    savings_rate_pct = round((net_flow / total_in) * 100, 1) if total_in > 0 else 0.0

    largest_outflow_row = None
    largest_inflow_row = None
    for row in rows:
        amount = float(row.get("amount") or 0)
        if amount < 0 and not _is_internal_transfer_to_savings_or_investing(row):
            if largest_outflow_row is None or abs(amount) > abs(float(largest_outflow_row.get("amount") or 0)):
                largest_outflow_row = row
        if amount > 0 and not _is_internal_transfer_from_savings_or_investing(row):
            if largest_inflow_row is None or amount > float(largest_inflow_row.get("amount") or 0):
                largest_inflow_row = row

    top_spending_category = categories[0] if categories else None
    top_spending_share_pct = 0.0
    if top_spending_category and total_out > 0:
        top_spending_share_pct = round((float(top_spending_category.get("total_out") or 0) / total_out) * 100, 1)

    insights = {
        "months_count": months_count,
        "positive_months": positive_months,
        "avg_monthly_in": avg_monthly_in,
        "avg_monthly_out": avg_monthly_out,
        "savings_rate_pct": savings_rate_pct,
        "largest_outflow": {
            "amount": round(abs(float(largest_outflow_row.get("amount") or 0)), 2),
            "description": str(largest_outflow_row.get("description") or "").strip(),
            "category": str(largest_outflow_row.get("category") or "Other").strip() or "Other",
            "transaction_date": str(largest_outflow_row.get("transaction_date") or ""),
        }
        if largest_outflow_row
        else None,
        "largest_inflow": {
            "amount": round(float(largest_inflow_row.get("amount") or 0), 2),
            "description": str(largest_inflow_row.get("description") or "").strip(),
            "category": str(largest_inflow_row.get("category") or "Other").strip() or "Other",
            "transaction_date": str(largest_inflow_row.get("transaction_date") or ""),
        }
        if largest_inflow_row
        else None,
        "top_spending_category": {
            "category": str(top_spending_category.get("category") or "Other").strip() or "Other",
            "total_out": round(float(top_spending_category.get("total_out") or 0), 2),
            "share_pct": top_spending_share_pct,
        }
        if top_spending_category
        else None,
    }

    return JsonResponse(
        {
            "summary": summary,
            "insights": insights,
            "monthly": monthly,
            "categories": categories,
            "latest_transaction_date": latest_transaction_date.isoformat() if latest_transaction_date else "",
        }
    )


@require_GET
def chequing_categories(request):
    include_hidden = parse_bool_query(request.GET.get("include_hidden"))
    queryset = ChequingTransaction.objects.filter(user=request.user)
    if not include_hidden:
        queryset = queryset.filter(is_hidden=False)

    rows = queryset.values_list("category", flat=True).distinct().order_by("category")
    categories = sorted({str(value or "Other").strip() or "Other" for value in rows})
    return JsonResponse(categories, safe=False)


@require_GET
def chequing_accounts(request):
    include_hidden = parse_bool_query(request.GET.get("include_hidden"))
    tx_counts = {
        str(row["account_label"] or "").strip(): int(row["count"] or 0)
        for row in ChequingTransaction.objects.filter(user=request.user)
        .values("account_label")
        .annotate(count=Count("id"))
        if str(row["account_label"] or "").strip()
    }
    providers_by_label = {
        str(row.get("label") or "").strip(): str(row.get("provider") or CHEQUING_DEFAULT_PROVIDER).strip() or CHEQUING_DEFAULT_PROVIDER
        for row in ChequingAccount.objects.filter(user=request.user).values("label", "provider")
        if str(row.get("label") or "").strip()
    }
    accounts = set(providers_by_label.keys())

    tx_queryset = ChequingTransaction.objects.filter(user=request.user)
    if not include_hidden:
        tx_queryset = tx_queryset.filter(is_hidden=False)

    tx_labels = tx_queryset.values_list("account_label", flat=True).distinct()
    for label in tx_labels:
        normalized = str(label or "").strip()
        if not normalized:
            continue
        accounts.add(normalized)
        if normalized not in providers_by_label:
            providers_by_label[normalized] = CHEQUING_DEFAULT_PROVIDER

    return JsonResponse([
        {
            "label": label,
            "provider": providers_by_label.get(label, CHEQUING_DEFAULT_PROVIDER),
            "transactions": tx_counts.get(label, 0),
        }
        for label in sorted(accounts)
    ], safe=False)


@require_http_methods(["POST"])
def create_chequing_account(request):
    payload = _read_json(request)
    label = _normalize_account_label(payload.get("label"))
    provider = _normalize_chequing_provider(payload.get("provider"))
    if not label:
        return JsonResponse({"error": "label is required"}, status=400)
    if not provider:
        supported = ", ".join(CHEQUING_SUPPORTED_PROVIDERS.values())
        return JsonResponse({"error": f"Unsupported chequing bank. Supported banks: {supported}"}, status=400)

    account, created = ChequingAccount.objects.get_or_create(
        user=request.user,
        label=label,
        defaults={"provider": provider},
    )
    if not created:
        if account.provider != provider:
            return JsonResponse({"error": "Chequing account label already exists under a different bank"}, status=400)
        return JsonResponse({"error": "Chequing account already exists"}, status=400)

    return JsonResponse({"created": 1, "label": account.label, "provider": account.provider})


@require_http_methods(["PATCH"])
def rename_chequing_account(request, account_label):
    payload = _read_json(request)
    new_label = _normalize_account_label(payload.get("new_label"))
    old_label = _normalize_account_label(account_label)

    if not old_label:
        return JsonResponse({"error": "account label is required"}, status=400)
    if not new_label:
        return JsonResponse({"error": "new_label is required"}, status=400)
    if new_label == old_label:
        return JsonResponse({"updated": 0, "old_label": old_label, "new_label": new_label})

    if ChequingAccount.objects.filter(user=request.user, label=new_label).exists():
        return JsonResponse({"error": "Chequing account already exists"}, status=400)

    tx_exists = ChequingTransaction.objects.filter(user=request.user, account_label=old_label).exists()
    account_exists = ChequingAccount.objects.filter(user=request.user, label=old_label).exists()
    if not tx_exists and not account_exists:
        return JsonResponse({"error": "Chequing account not found"}, status=404)

    ChequingTransaction.objects.filter(user=request.user, account_label=old_label).update(account_label=new_label)

    if account_exists:
        ChequingAccount.objects.filter(user=request.user, label=old_label).update(label=new_label)
    else:
        ChequingAccount.objects.create(user=request.user, label=new_label, provider=CHEQUING_DEFAULT_PROVIDER)

    return JsonResponse({"updated": 1, "old_label": old_label, "new_label": new_label})


@require_http_methods(["DELETE"])
def delete_chequing_account(request, account_label):
    label = _normalize_account_label(account_label)
    if not label:
        return JsonResponse({"error": "account label is required"}, status=400)

    deleted_tx, _ = ChequingTransaction.objects.filter(user=request.user, account_label=label).delete()
    ChequingAccount.objects.filter(user=request.user, label=label).delete()

    if deleted_tx == 0:
        return JsonResponse({"error": "Chequing account not found"}, status=404)

    return JsonResponse({"deleted": deleted_tx, "account_label": label})


@require_GET
def chequing_transactions(request):
    start_date = str(request.GET.get("start_date") or "").strip()
    end_date = str(request.GET.get("end_date") or "").strip()
    category = str(request.GET.get("category") or "").strip()
    search = str(request.GET.get("search") or "").strip()
    account_label = str(request.GET.get("account_label") or "").strip()
    direction = str(request.GET.get("direction") or "").strip().lower()
    include_zero = parse_bool_query(request.GET.get("include_zero"))
    include_hidden = parse_bool_query(request.GET.get("include_hidden"))
    limit_raw = str(request.GET.get("limit") or "").strip().lower()

    if not limit_raw:
        limit = 300
    elif limit_raw in {"all", "none"}:
        limit = None
    else:
        try:
            limit = int(limit_raw)
        except ValueError:
            return JsonResponse({"error": "limit must be an integer or 'all'"}, status=400)
        if limit < 1:
            return JsonResponse({"error": "limit must be >= 1 or 'all'"}, status=400)

    queryset = ChequingTransaction.objects.filter(user=request.user)
    if start_date:
        queryset = queryset.filter(transaction_date__gte=start_date)
    if end_date:
        queryset = queryset.filter(transaction_date__lte=end_date)
    if category:
        queryset = queryset.filter(category=category)
    if account_label:
        queryset = queryset.filter(account_label=account_label)
    if search:
        queryset = queryset.filter(description__icontains=search)
    if direction == "in":
        queryset = queryset.filter(amount__gt=0)
    elif direction == "out":
        queryset = queryset.filter(amount__lt=0)
    if not include_zero:
        queryset = queryset.exclude(amount=0)
    if not include_hidden:
        queryset = queryset.filter(is_hidden=False)

    rows = queryset.order_by("-transaction_date", "-id")

    data = []
    for row in rows:
        data.append(_tx_dict(row))
        if limit is not None and len(data) >= limit:
            break

    return JsonResponse(data, safe=False)


@require_http_methods(["PATCH"])
def set_chequing_transaction_hidden(request, transaction_id):
    payload = _read_json(request)
    hidden = bool(payload.get("hidden", True))

    updated = ChequingTransaction.objects.filter(
        id=transaction_id,
        user=request.user,
    ).update(is_hidden=hidden)
    if updated == 0:
        return JsonResponse({"error": "Chequing transaction not found"}, status=404)
    return JsonResponse({"updated": 1, "hidden": hidden})


@require_http_methods(["POST"])
def set_many_chequing_transactions_hidden(request):
    payload = _read_json(request)
    hidden = bool(payload.get("hidden", True))
    ids = payload.get("ids")
    if not isinstance(ids, list) or len(ids) == 0:
        return JsonResponse({"error": "ids must be a non-empty array"}, status=400)

    normalized_ids = []
    for item in ids:
        try:
            normalized_ids.append(int(item))
        except (TypeError, ValueError):
            return JsonResponse({"error": "ids must contain only integers"}, status=400)

    updated = ChequingTransaction.objects.filter(
        user=request.user,
        id__in=normalized_ids,
    ).update(is_hidden=hidden)

    return JsonResponse({"updated": updated, "hidden": hidden})


@require_http_methods(["DELETE"])
def delete_chequing_transaction(request, transaction_id):
    deleted, _ = ChequingTransaction.objects.filter(
        id=transaction_id,
        user=request.user,
    ).delete()
    if deleted == 0:
        return JsonResponse({"error": "Chequing transaction not found"}, status=404)
    return JsonResponse({"deleted": 1})


@require_http_methods(["POST"])
def delete_many_chequing_transactions(request):
    payload = _read_json(request)
    ids = payload.get("ids")
    if not isinstance(ids, list) or len(ids) == 0:
        return JsonResponse({"error": "ids must be a non-empty array"}, status=400)

    normalized_ids = []
    for item in ids:
        try:
            normalized_ids.append(int(item))
        except (TypeError, ValueError):
            return JsonResponse({"error": "ids must contain only integers"}, status=400)

    deleted, _ = ChequingTransaction.objects.filter(
        user=request.user,
        id__in=normalized_ids,
    ).delete()

    return JsonResponse({"deleted": deleted})


@require_http_methods(["POST"])
def recategorize_chequing_transactions(request):
    queryset = ChequingTransaction.objects.filter(user=request.user)
    scanned = queryset.count()

    to_update = []
    for row in queryset.iterator():
        normalized_category = normalize_chequing_category(row.transaction_code, row.description, row.amount)
        if not normalized_category:
            continue
        current_category = str(row.category or "").strip()
        if current_category == normalized_category:
            continue
        row.category = normalized_category
        to_update.append(row)

    if to_update:
        ChequingTransaction.objects.bulk_update(to_update, ["category"])

    return JsonResponse({"scanned": scanned, "updated": len(to_update)})


@require_http_methods(["DELETE"])
def delete_all_chequing_transactions(request):
    account_label = str(request.GET.get("account_label") or "").strip()
    queryset = ChequingTransaction.objects.filter(user=request.user)
    if account_label:
        queryset = queryset.filter(account_label=account_label)
    deleted, _ = queryset.delete()
    return JsonResponse({"deleted": deleted})
