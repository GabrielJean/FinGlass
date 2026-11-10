import json
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_http_methods

from core.models import CreditCardAccount, CreditCardTransaction
from core.services.credit_card_categories import normalize_credit_card_category
from core.services.credit_card_service import parse_bool_query, parse_credit_card_category_filters


CREDIT_CARD_SUPPORTED_PROVIDERS = {
    "rogers": "rogers_bank",
    "rogers_bank": "rogers_bank",
    "wealthsimple": "wealthsimple",
    "ws": "wealthsimple",
}


def _read_json(request):
    try:
        if not request.body:
            return {}
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}


def _tx_dict(row):
    return {
        "id": row.id,
        "provider": row.provider,
        "card_label": row.card_label or row.provider or "",
        "transaction_date": row.transaction_date.isoformat() if row.transaction_date else "",
        "posted_date": row.posted_date.isoformat() if row.posted_date else None,
        "card_last4": row.card_last4,
        "merchant_category": row.merchant_category,
        "merchant_name": row.merchant_name,
        "merchant_city": row.merchant_city,
        "merchant_region": row.merchant_region,
        "merchant_country": row.merchant_country,
        "amount": float(row.amount or 0),
        "rewards": float(row.rewards or 0),
        "is_hidden": bool(row.is_hidden),
        "status": row.status,
        "activity_type": row.activity_type,
        "reference_number": row.reference_number,
    }


def _normalize_credit_card_provider(value):
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    return CREDIT_CARD_SUPPORTED_PROVIDERS.get(raw, raw)


@require_http_methods(["GET", "DELETE"])
def credit_card_transactions_collection(request):
    if request.method == "GET":
        return credit_card_transactions(request)
    return delete_all_credit_card_transactions(request)


@require_GET
def credit_card_dashboard(request):
    provider = str(request.GET.get("provider") or "").strip()
    card_label = str(request.GET.get("card_label") or request.GET.get("card") or "").strip()
    start_date = str(request.GET.get("start_date") or "").strip()
    end_date = str(request.GET.get("end_date") or "").strip()
    merchant = str(request.GET.get("merchant") or request.GET.get("search") or "").strip()
    include_hidden = parse_bool_query(request.GET.get("include_hidden"))
    selected_categories = {
        normalize_credit_card_category(category)
        for category in parse_credit_card_category_filters(request.GET)
    }

    queryset = CreditCardTransaction.objects.filter(user=request.user)
    if provider:
        queryset = queryset.filter(provider=provider)
    if card_label:
        # Search for transactions with the exact card_label OR with provider matching the label
        # (in case the label came from the provider field when card_label was empty)
        queryset = queryset.filter(Q(card_label=card_label) | Q(provider=card_label))
    if start_date:
        queryset = queryset.filter(transaction_date__gte=start_date)
    if end_date:
        queryset = queryset.filter(transaction_date__lte=end_date)
    if merchant:
        queryset = queryset.filter(merchant_name__icontains=merchant)
    if not include_hidden:
        queryset = queryset.filter(is_hidden=False)

    raw_rows = queryset.values(
        "id", "provider", "card_label", "transaction_date", "posted_date",
        "card_last4", "merchant_category", "merchant_name", "merchant_city",
        "merchant_region", "merchant_country", "amount", "rewards",
        "is_hidden", "status", "activity_type", "reference_number"
    )

    expense_rows = []
    total_expenses = 0.0
    total_rewards = 0.0
    largest_transaction = 0.0
    monthly_totals = defaultdict(float)
    category_totals = defaultdict(lambda: {"amount": 0.0, "transaction_count": 0})
    merchant_totals = defaultdict(lambda: {"amount": 0.0, "transaction_count": 0})
    unique_spend_days = set()
    latest_transaction_date = None

    for row in raw_rows:
        cat = normalize_credit_card_category(row["merchant_category"])
        if selected_categories and cat not in selected_categories:
            continue
        amt = float(row["amount"] or 0)
        if amt <= 0:
            continue

        tx_date = row["transaction_date"]
        tx_date_str = tx_date.isoformat() if tx_date else ""
        if tx_date_str:
            unique_spend_days.add(tx_date_str)
            if latest_transaction_date is None or tx_date_str > latest_transaction_date:
                latest_transaction_date = tx_date_str
            month = tx_date_str[:7]
            monthly_totals[month] += amt

        total_expenses += amt
        rew = float(row["rewards"] or 0)
        total_rewards += rew
        if amt > largest_transaction:
            largest_transaction = amt

        category_totals[cat]["amount"] += amt
        category_totals[cat]["transaction_count"] += 1

        merchant_name = str(row["merchant_name"] or "").strip() or "Unknown Merchant"
        merchant_totals[merchant_name]["amount"] += amt
        merchant_totals[merchant_name]["transaction_count"] += 1

        mapped = {
            "id": row["id"],
            "provider": row["provider"],
            "card_label": row["card_label"] or row["provider"] or "",
            "transaction_date": tx_date_str,
            "posted_date": row["posted_date"].isoformat() if row["posted_date"] else None,
            "card_last4": row["card_last4"],
            "merchant_category": cat,
            "merchant_name": row["merchant_name"],
            "merchant_city": row["merchant_city"],
            "merchant_region": row["merchant_region"],
            "merchant_country": row["merchant_country"],
            "amount": amt,
            "rewards": rew,
            "is_hidden": bool(row["is_hidden"]),
            "status": row["status"],
            "activity_type": row["activity_type"],
            "reference_number": row["reference_number"],
        }
        expense_rows.append(mapped)

    total_expenses = round(total_expenses, 2)
    summary = {
        "total_expenses": total_expenses,
        "total_spending": total_expenses,
        "transactions": len(expense_rows),
        "transaction_count": len(expense_rows),
    }

    monthly = [{"month": month, "expenses": round(monthly_totals[month], 2)} for month in sorted(monthly_totals.keys())]

    categories = []
    for category_name, totals in category_totals.items():
        tx_count = totals["transaction_count"]
        amount = round(totals["amount"], 2)
        categories.append(
            {
                "merchant_category": category_name,
                "amount": amount,
                "transaction_count": tx_count,
                "average_amount": round(amount / tx_count, 2) if tx_count else 0,
            }
        )
    categories.sort(key=lambda row: row["amount"], reverse=True)

    merchants = []
    for merchant_name, totals in merchant_totals.items():
        tx_count = totals["transaction_count"]
        amount = round(totals["amount"], 2)
        merchants.append(
            {
                "merchant_name": merchant_name,
                "amount": amount,
                "transaction_count": tx_count,
                "average_amount": round(amount / tx_count, 2) if tx_count else 0,
            }
        )
    merchants.sort(key=lambda row: row["amount"], reverse=True)

    months_count = len(monthly)
    avg_monthly_expenses = round(total_expenses / months_count, 2) if months_count else 0.0
    avg_transaction = round(total_expenses / len(expense_rows), 2) if expense_rows else 0.0
    largest_transaction = round(largest_transaction, 2)
    total_rewards = round(total_rewards, 2)
    rewards_rate_pct = round((total_rewards / total_expenses) * 100, 2) if total_expenses > 0 else 0.0

    avg_daily_spend = round(total_expenses / len(unique_spend_days), 2) if unique_spend_days else 0.0

    top_category = categories[0] if categories else None
    top_category_share_pct = 0.0
    if top_category and total_expenses > 0:
        top_category_share_pct = round((float(top_category.get("amount") or 0) / total_expenses) * 100, 1)

    top_merchant = merchants[0] if merchants else None
    top_merchant_share_pct = 0.0
    if top_merchant and total_expenses > 0:
        top_merchant_share_pct = round((float(top_merchant.get("amount") or 0) / total_expenses) * 100, 1)

    insights = {
        "months_count": months_count,
        "avg_monthly_expenses": avg_monthly_expenses,
        "avg_transaction": avg_transaction,
        "largest_transaction": largest_transaction,
        "avg_daily_spend": avg_daily_spend,
        "total_rewards": total_rewards,
        "rewards_rate_pct": rewards_rate_pct,
        "top_category": {
            "merchant_category": str(top_category.get("merchant_category") or "Uncategorized"),
            "amount": round(float(top_category.get("amount") or 0), 2),
            "share_pct": top_category_share_pct,
        }
        if top_category
        else None,
        "top_merchant": {
            "merchant_name": str(top_merchant.get("merchant_name") or "Unknown Merchant"),
            "amount": round(float(top_merchant.get("amount") or 0), 2),
            "share_pct": top_merchant_share_pct,
        }
        if top_merchant
        else None,
    }

    recent_rows = sorted(
        expense_rows,
        key=lambda row: (row.get("transaction_date") or "", int(row.get("id") or 0)),
        reverse=True,
    )[:80]

    return JsonResponse(
        {
            "provider": provider,
            "latest_transaction_date": latest_transaction_date,
            "summary": summary,
            "insights": insights,
            "total_spending": total_expenses,
            "total_rewards": total_rewards,
            "transaction_count": len(expense_rows),
            "monthly": monthly,
            "categories": categories,
            "top_merchants": merchants,
            "recent": recent_rows,
        }
    )


@require_GET
def credit_card_categories(request):
    provider = str(request.GET.get("provider") or "").strip()
    card_label = str(request.GET.get("card_label") or "").strip()
    queryset = CreditCardTransaction.objects.filter(user=request.user, is_hidden=False)
    if provider:
        queryset = queryset.filter(provider=provider)
    if card_label:
        queryset = queryset.filter(card_label=card_label)
    rows = queryset.values_list("merchant_category", flat=True).distinct().order_by("merchant_category")
    categories = sorted(
        {
            normalize_credit_card_category(value if value else "Uncategorized")
            for value in rows
            if value is not None
        }
    )
    return JsonResponse(categories, safe=False)


@require_GET
def credit_card_transactions(request):
    provider = str(request.GET.get("provider") or "").strip()
    card_label = str(request.GET.get("card_label") or request.GET.get("card") or "").strip()
    start_date = str(request.GET.get("start_date") or "").strip()
    end_date = str(request.GET.get("end_date") or "").strip()
    selected_categories = {
        normalize_credit_card_category(category)
        for category in parse_credit_card_category_filters(request.GET)
    }
    merchant = str(request.GET.get("merchant") or request.GET.get("search") or "").strip()
    include_payments = parse_bool_query(request.GET.get("include_payments"))
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

    queryset = CreditCardTransaction.objects.filter(user=request.user)
    if provider:
        queryset = queryset.filter(provider=provider)
    if card_label:
        # Search for transactions with the exact card_label OR with provider matching the label
        # (in case the label came from the provider field when card_label was empty)
        queryset = queryset.filter(Q(card_label=card_label) | Q(provider=card_label))
    if start_date:
        queryset = queryset.filter(transaction_date__gte=start_date)
    if end_date:
        queryset = queryset.filter(transaction_date__lte=end_date)
    if merchant:
        queryset = queryset.filter(merchant_name__icontains=merchant)
    if not include_payments:
        queryset = queryset.filter(amount__gt=0)
    if not include_hidden:
        queryset = queryset.filter(is_hidden=False)

    if not selected_categories and limit is not None:
        queryset = queryset.order_by("-transaction_date", "-id")[:limit]
    else:
        queryset = queryset.order_by("-transaction_date", "-id")

    raw_rows = queryset.values(
        "id", "provider", "card_label", "transaction_date", "posted_date",
        "card_last4", "merchant_category", "merchant_name", "merchant_city",
        "merchant_region", "merchant_country", "amount", "rewards",
        "is_hidden", "status", "activity_type", "reference_number"
    )

    normalized_rows = []
    for row in raw_rows:
        cat = normalize_credit_card_category(row["merchant_category"])
        if selected_categories and cat not in selected_categories:
            continue
        mapped = {
            "id": row["id"],
            "provider": row["provider"],
            "card_label": row["card_label"] or row["provider"] or "",
            "transaction_date": row["transaction_date"].isoformat() if row["transaction_date"] else "",
            "posted_date": row["posted_date"].isoformat() if row["posted_date"] else None,
            "card_last4": row["card_last4"],
            "merchant_category": cat,
            "merchant_name": row["merchant_name"],
            "merchant_city": row["merchant_city"],
            "merchant_region": row["merchant_region"],
            "merchant_country": row["merchant_country"],
            "amount": float(row["amount"] or 0),
            "rewards": float(row["rewards"] or 0),
            "is_hidden": bool(row["is_hidden"]),
            "status": row["status"],
            "activity_type": row["activity_type"],
            "reference_number": row["reference_number"],
        }
        normalized_rows.append(mapped)
        if limit is not None and len(normalized_rows) >= limit:
            break

    return JsonResponse(normalized_rows, safe=False)


@require_GET
def credit_card_cards(request):
    provider = _normalize_credit_card_provider(request.GET.get("provider"))
    queryset = CreditCardTransaction.objects.filter(user=request.user)
    if provider:
        queryset = queryset.filter(provider=provider)

    accounts_queryset = CreditCardAccount.objects.filter(user=request.user)
    if provider:
        accounts_queryset = accounts_queryset.filter(provider=provider)

    cards = {
        str(label or "").strip()
        for label in accounts_queryset.values_list("label", flat=True)
        if str(label or "").strip()
    }

    rows = queryset.values_list("card_label", "provider").distinct()
    for card, provider_name in rows:
        normalized = str(card if card else provider_name if provider_name else "").strip()
        if normalized:
            cards.add(normalized)

    cards = sorted(cards)
    return JsonResponse(cards, safe=False)


@require_GET
def credit_card_cards_manage(request):
    provider_by_label = {
        str(row["label"] or "").strip(): str(row["provider"] or "").strip()
        for row in CreditCardAccount.objects.filter(user=request.user).values("label", "provider")
        if str(row["label"] or "").strip()
    }

    tx_rows = CreditCardTransaction.objects.filter(user=request.user).values("card_label", "provider").distinct()
    for row in tx_rows:
        label = str(row.get("card_label") or row.get("provider") or "").strip()
        if not label:
            continue
        if label not in provider_by_label:
            provider_by_label[label] = str(row.get("provider") or "").strip()

    result = []
    for label in sorted(provider_by_label.keys()):
        count = CreditCardTransaction.objects.filter(user=request.user).filter(
            Q(card_label=label) | (Q(card_label__in=["", None]) & Q(provider=label))
        ).count()
        result.append({
            "provider": provider_by_label.get(label, "") or "",
            "label": label,
            "transactions": count,
        })

    return JsonResponse(result, safe=False)


@require_http_methods(["POST"])
def create_credit_card(request):
    payload = _read_json(request)
    label = str(payload.get("label") or "").strip()
    provider = _normalize_credit_card_provider(payload.get("provider"))

    if not label:
        return JsonResponse({"error": "label is required"}, status=400)
    if provider not in {"rogers_bank", "wealthsimple"}:
        return JsonResponse({"error": "Unsupported credit card bank. Supported banks: Rogers Bank, Wealthsimple"}, status=400)

    account, created = CreditCardAccount.objects.get_or_create(
        user=request.user,
        label=label,
        defaults={"provider": provider},
    )
    if not created:
        if account.provider != provider:
            return JsonResponse({"error": "Card label already exists under a different bank"}, status=400)
        return JsonResponse({"error": "Credit card already exists"}, status=400)

    return JsonResponse({"created": 1, "provider": account.provider, "label": account.label})


@require_http_methods(["PATCH"])
def set_credit_card_transaction_hidden(request, transaction_id):
    payload = _read_json(request)
    hidden = bool(payload.get("hidden", True))

    updated = CreditCardTransaction.objects.filter(
        id=transaction_id,
        user=request.user,
    ).update(is_hidden=hidden)
    if updated == 0:
        return JsonResponse({"error": "Credit card transaction not found"}, status=404)
    return JsonResponse({"updated": 1, "hidden": hidden})


@require_http_methods(["POST"])
def set_many_credit_card_transactions_hidden(request):
    payload = _read_json(request)
    hidden = bool(payload.get("hidden", True) if "hidden" in payload else payload.get("is_hidden", True))
    raw_ids = payload.get("ids") or payload.get("transaction_ids")
    if not isinstance(raw_ids, list) or len(raw_ids) == 0:
        return JsonResponse({"error": "ids must be a non-empty array"}, status=400)

    normalized_ids = []
    for item in raw_ids:
        try:
            normalized_ids.append(int(item))
        except (TypeError, ValueError):
            return JsonResponse({"error": "ids must contain only integers"}, status=400)

    updated = CreditCardTransaction.objects.filter(
        user=request.user,
        id__in=normalized_ids,
    ).update(is_hidden=hidden)

    return JsonResponse({"updated": updated, "hidden": hidden})


@require_http_methods(["PUT", "PATCH"])
def update_credit_card_transaction(request, transaction_id):
    tx = CreditCardTransaction.objects.filter(id=transaction_id, user=request.user).first()
    if not tx:
        return JsonResponse({"error": "Credit card transaction not found"}, status=404)

    payload = _read_json(request)

    if "merchant_name" in payload:
        name = str(payload.get("merchant_name") or "").strip()
        if not name:
            return JsonResponse({"error": "Merchant name cannot be empty"}, status=400)
        tx.merchant_name = name

    if "amount" in payload:
        try:
            amt = Decimal(str(payload.get("amount") or "").strip())
        except (InvalidOperation, TypeError, ValueError):
            return JsonResponse({"error": "amount must be a valid number"}, status=400)
        tx.amount = amt

    if "transaction_date" in payload:
        dt_str = str(payload.get("transaction_date") or "").strip()
        try:
            tx.transaction_date = datetime.strptime(dt_str, "%Y-%m-%d").date()
        except ValueError:
            return JsonResponse({"error": "transaction_date must be in YYYY-MM-DD format"}, status=400)

    if "card_label" in payload:
        new_card_label = str(payload.get("card_label") or "").strip()
        tx.card_label = new_card_label or None
        if new_card_label:
            CreditCardAccount.objects.get_or_create(
                user=request.user,
                label=new_card_label,
                defaults={"provider": tx.provider or "custom"},
            )

    if "merchant_category" in payload:
        cat = str(payload.get("merchant_category") or "").strip()
        tx.merchant_category = normalize_credit_card_category(cat) if cat else "Other"

    if "is_hidden" in payload:
        tx.is_hidden = bool(payload.get("is_hidden"))

    tx.save()

    return JsonResponse({"updated": 1, "transaction": _tx_dict(tx)})


@require_http_methods(["DELETE"])
def delete_credit_card_transaction(request, transaction_id):
    deleted, _ = CreditCardTransaction.objects.filter(
        id=transaction_id,
        user=request.user,
    ).delete()
    if deleted == 0:
        return JsonResponse({"error": "Credit card transaction not found"}, status=404)
    return JsonResponse({"deleted": 1})


@require_http_methods(["PUT", "PATCH", "DELETE"])
def credit_card_transaction_item(request, transaction_id):
    if request.method == "DELETE":
        return delete_credit_card_transaction(request, transaction_id)
    return update_credit_card_transaction(request, transaction_id)


@require_http_methods(["POST", "PATCH"])
def update_many_credit_card_transactions(request):
    payload = _read_json(request)
    raw_ids = payload.get("ids") or payload.get("transaction_ids")
    if not isinstance(raw_ids, list) or len(raw_ids) == 0:
        return JsonResponse({"error": "ids must be a non-empty list of integers"}, status=400)

    normalized_ids = []
    for item in raw_ids:
        try:
            normalized_ids.append(int(item))
        except (TypeError, ValueError):
            return JsonResponse({"error": "ids must contain only integers"}, status=400)

    queryset = CreditCardTransaction.objects.filter(user=request.user, id__in=normalized_ids)
    if not queryset.exists():
        return JsonResponse({"error": "No matching transactions found"}, status=404)

    update_fields = {}

    if "card_label" in payload and payload["card_label"] is not None:
        card_label = str(payload["card_label"]).strip()
        if card_label:
            update_fields["card_label"] = card_label
            CreditCardAccount.objects.get_or_create(
                user=request.user,
                label=card_label,
                defaults={"provider": "custom"},
            )

    if "merchant_category" in payload and payload["merchant_category"] is not None:
        cat = str(payload["merchant_category"]).strip()
        if cat:
            update_fields["merchant_category"] = normalize_credit_card_category(cat)

    if "merchant_name" in payload and payload["merchant_name"] is not None:
        name = str(payload["merchant_name"]).strip()
        if name:
            update_fields["merchant_name"] = name

    if "transaction_date" in payload and payload["transaction_date"] is not None:
        dt_str = str(payload["transaction_date"]).strip()
        if dt_str:
            try:
                dt = datetime.strptime(dt_str, "%Y-%m-%d").date()
                update_fields["transaction_date"] = dt
            except ValueError:
                return JsonResponse({"error": "transaction_date must be in YYYY-MM-DD format"}, status=400)

    if "amount" in payload and payload["amount"] is not None:
        amt_str = str(payload["amount"]).strip()
        if amt_str:
            try:
                update_fields["amount"] = Decimal(amt_str)
            except (InvalidOperation, TypeError, ValueError):
                return JsonResponse({"error": "amount must be a valid number"}, status=400)

    if "is_hidden" in payload and payload["is_hidden"] is not None:
        update_fields["is_hidden"] = bool(payload["is_hidden"])

    if not update_fields:
        return JsonResponse({"error": "No valid fields provided for update"}, status=400)

    updated_count = queryset.update(**update_fields)

    return JsonResponse({"updated": updated_count})


@require_http_methods(["POST"])
def delete_many_credit_card_transactions(request):
    payload = _read_json(request)
    raw_ids = payload.get("ids") or payload.get("transaction_ids")
    if not isinstance(raw_ids, list) or len(raw_ids) == 0:
        return JsonResponse({"error": "ids must be a non-empty array"}, status=400)

    normalized_ids = []
    for item in raw_ids:
        try:
            normalized_ids.append(int(item))
        except (TypeError, ValueError):
            return JsonResponse({"error": "ids must contain only integers"}, status=400)

    deleted, _ = CreditCardTransaction.objects.filter(
        user=request.user,
        id__in=normalized_ids,
    ).delete()

    return JsonResponse({"deleted": deleted})


@require_http_methods(["DELETE"])
def delete_all_credit_card_transactions(request):
    provider = str(request.GET.get("provider") or "").strip()
    queryset = CreditCardTransaction.objects.filter(user=request.user)
    if provider:
        queryset = queryset.filter(provider=provider)
    deleted, _ = queryset.delete()
    return JsonResponse({"deleted": deleted})


@require_http_methods(["POST"])
def recategorize_credit_card_transactions(request):
    payload = _read_json(request)
    raw_ids = payload.get("ids") or payload.get("transaction_ids")
    target_category = str(payload.get("merchant_category") or "").strip()

    if raw_ids and isinstance(raw_ids, list):
        if not target_category:
            return JsonResponse({"error": "merchant_category is required"}, status=400)
        norm_cat = normalize_credit_card_category(target_category)
        normalized_ids = []
        for item in raw_ids:
            try:
                normalized_ids.append(int(item))
            except (TypeError, ValueError):
                pass
        updated = CreditCardTransaction.objects.filter(
            user=request.user,
            id__in=normalized_ids
        ).update(merchant_category=norm_cat)
        return JsonResponse({"updated": updated, "merchant_category": norm_cat})

    queryset = CreditCardTransaction.objects.filter(user=request.user)
    scanned = queryset.count()

    to_update = []
    for row in queryset.iterator():
        normalized_category = normalize_credit_card_category(row.merchant_category)
        current_category = str(row.merchant_category or "").strip()
        if current_category == normalized_category:
            continue
        row.merchant_category = normalized_category
        to_update.append(row)

    if to_update:
        CreditCardTransaction.objects.bulk_update(to_update, ["merchant_category"])

    return JsonResponse({"scanned": scanned, "updated": len(to_update)})


@require_http_methods(["POST", "PATCH"])
def rename_credit_card(request, card_label):
    payload = _read_json(request)
    new_label = str(payload.get("new_label") or payload.get("label") or "").strip()

    if not new_label:
        return JsonResponse({"error": "new_label is required"}, status=400)
    if new_label == card_label:
        return JsonResponse({"updated": 0, "old_label": card_label, "new_label": new_label})

    account = CreditCardAccount.objects.filter(user=request.user, label=card_label).first()
    target_account = CreditCardAccount.objects.filter(user=request.user, label=new_label).first()

    # If target already exists, allow merging!
    if target_account:
        if account and account.id != target_account.id:
            account.delete()
    elif account:
        account.label = new_label
        account.save(update_fields=["label"])
    else:
        provider_value = (
            CreditCardTransaction.objects.filter(user=request.user)
            .filter(Q(card_label=card_label) | (Q(card_label__in=["", None]) & Q(provider=card_label)))
            .values_list("provider", flat=True)
            .first()
            or "wealthsimple"
        )
        CreditCardAccount.objects.create(user=request.user, provider=str(provider_value or "").strip(), label=new_label)

    updated = CreditCardTransaction.objects.filter(
        user=request.user
    ).filter(
        Q(card_label=card_label) | (Q(card_label__in=["", None]) & Q(provider=card_label))
    ).update(card_label=new_label)

    if updated == 0 and not account and not target_account:
        return JsonResponse({"error": "Credit card not found"}, status=404)

    return JsonResponse({
        "updated": updated,
        "old_label": card_label,
        "new_label": new_label,
        "merged": bool(target_account),
    })


@require_http_methods(["POST", "DELETE"])
def delete_credit_card(request, card_label):
    account_deleted, _ = CreditCardAccount.objects.filter(user=request.user, label=card_label).delete()

    deleted, _ = CreditCardTransaction.objects.filter(
        user=request.user
    ).filter(
        Q(card_label=card_label) | (Q(card_label__in=["", None]) & Q(provider=card_label))
    ).delete()

    if deleted == 0 and account_deleted == 0:
        return JsonResponse({"error": "Credit card not found"}, status=404)

    return JsonResponse({"deleted": deleted, "account_deleted": account_deleted, "card_label": card_label})
