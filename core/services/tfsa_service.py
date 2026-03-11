from datetime import datetime

from django.db import transaction

from core.models import AppSetting, TfsaAccount, TfsaAnnualLimit, TfsaContribution


ROOM_EPSILON = 0.005
TFSA_DEFAULT_ANNUAL_LIMITS = {
    2009: 5000.0,
    2010: 5000.0,
    2011: 5000.0,
    2012: 5000.0,
    2013: 5500.0,
    2014: 5500.0,
    2015: 10000.0,
    2016: 5500.0,
    2017: 5500.0,
    2018: 5500.0,
    2019: 6000.0,
    2020: 6000.0,
    2021: 6000.0,
    2022: 6000.0,
    2023: 6500.0,
    2024: 7000.0,
    2025: 7000.0,
    2026: 7000.0,
}


def _coerce_year(value):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return int(text[:4])
    except (TypeError, ValueError):
        return None


def _is_transfer_memo(memo):
    normalized = str(memo or "")
    return (
        normalized.startswith("[Transfer ")
        or normalized.startswith("[Transfer to ")
        or normalized.startswith("[Transfer from ")
    )


def _build_annual_limit_map(annual_limits):
    annual_limit_map = {}
    for limit in annual_limits or []:
        try:
            year = int(limit["year"])
            value = float(limit["annual_limit"])
        except (KeyError, TypeError, ValueError):
            continue
        annual_limit_map[year] = value
    return annual_limit_map


def _resolve_include_base_year_annual_limit(opening_balance, base_year, annual_limit_map, evaluated_year, room_used):
    if base_year is None:
        return False

    try:
        normalized_base_year = int(base_year)
        normalized_evaluated_year = int(evaluated_year)
    except (TypeError, ValueError):
        return False

    if normalized_evaluated_year < normalized_base_year:
        return False

    base_year_limit = float(annual_limit_map.get(normalized_base_year) or 0.0)
    if base_year_limit <= 0.0:
        return False

    annual_excluding_base = sum(
        float(value)
        for year, value in annual_limit_map.items()
        if (normalized_base_year + 1) <= int(year) <= normalized_evaluated_year
    )
    annual_including_base = annual_excluding_base + base_year_limit

    available_excluding_base = float(opening_balance or 0.0) + annual_excluding_base
    available_including_base = float(opening_balance or 0.0) + annual_including_base

    remaining_excluding_base = available_excluding_base - float(room_used or 0.0)
    remaining_including_base = available_including_base - float(room_used or 0.0)

    if remaining_excluding_base < -ROOM_EPSILON <= remaining_including_base:
        return True
    if remaining_including_base < -ROOM_EPSILON <= remaining_excluding_base:
        return False

    return abs(remaining_including_base) + ROOM_EPSILON < abs(remaining_excluding_base)


def is_user_tfsa_opening_balance_configured(user_id):
    return AppSetting.objects.filter(user_id=user_id, key="tfsa_opening_balance").exists()


def get_user_tfsa_opening_balance(user_id):
    row = AppSetting.objects.filter(user_id=user_id, key="tfsa_opening_balance").values("value").first()
    if not row:
        return 0
    try:
        return float(row["value"])
    except (TypeError, ValueError):
        return 0


def get_user_tfsa_opening_balance_base_year(user_id):
    row = AppSetting.objects.filter(user_id=user_id, key="tfsa_opening_balance_base_year").values("value").first()
    if not row:
        return None
    try:
        return int(str(row["value"]))
    except (TypeError, ValueError):
        return None


def _set_user_tfsa_opening_balance_base_year(user_id, year):
    AppSetting.objects.update_or_create(
        user_id=user_id,
        key="tfsa_opening_balance_base_year",
        defaults={"value": str(year)},
    )


def set_user_tfsa_opening_balance_base_year(user_id, year):
    normalized_year = int(year)
    _set_user_tfsa_opening_balance_base_year(user_id, normalized_year)


def set_user_tfsa_opening_balance(user_id, balance):
    AppSetting.objects.update_or_create(
        user_id=user_id,
        key="tfsa_opening_balance",
        defaults={"value": str(balance)},
    )

    existing_base_year = get_user_tfsa_opening_balance_base_year(user_id)
    if existing_base_year is None:
        _set_user_tfsa_opening_balance_base_year(user_id, datetime.now().year)


def ensure_tfsa_setup_from_import(user_id, inferred_base_year):
    normalized_base_year = int(inferred_base_year)
    normalized_base_year = max(2009, min(2100, normalized_base_year))

    if not is_user_tfsa_opening_balance_configured(user_id):
        AppSetting.objects.get_or_create(
            user_id=user_id,
            key="tfsa_opening_balance",
            defaults={"value": "0"},
        )

    current_base_year = get_user_tfsa_opening_balance_base_year(user_id)
    if current_base_year is None or normalized_base_year < int(current_base_year):
        _set_user_tfsa_opening_balance_base_year(user_id, normalized_base_year)


def list_user_tfsa_annual_limits(user_id):
    rows = TfsaAnnualLimit.objects.filter(user_id=user_id).order_by("-year").values("year", "annual_limit")
    return [{"year": int(row["year"]), "annual_limit": float(row["annual_limit"])} for row in rows]


def list_effective_tfsa_annual_limits(user_id):
    limits_by_year = dict(TFSA_DEFAULT_ANNUAL_LIMITS)
    override_years = set()
    for row in TfsaAnnualLimit.objects.filter(user_id=user_id).values("year", "annual_limit"):
        try:
            year = int(row["year"])
            annual_limit = float(row["annual_limit"])
        except (KeyError, TypeError, ValueError):
            continue
        limits_by_year[year] = annual_limit
        override_years.add(year)

    years_desc = sorted(limits_by_year.keys(), reverse=True)
    return [
        {
            "year": int(year),
            "annual_limit": float(limits_by_year[year]),
            "is_default": int(year) not in override_years,
            "can_delete": int(year) in override_years,
        }
        for year in years_desc
    ]


def upsert_user_tfsa_annual_limit(user_id, year, annual_limit):
    TfsaAnnualLimit.objects.update_or_create(
        user_id=user_id,
        year=year,
        defaults={"annual_limit": annual_limit},
    )


def delete_user_tfsa_annual_limit(user_id, year):
    deleted, _ = TfsaAnnualLimit.objects.filter(user_id=user_id, year=year).delete()
    return deleted > 0


def reset_user_tfsa_data(user_id):
    with transaction.atomic():
        TfsaContribution.objects.filter(user_id=user_id).delete()
        TfsaAccount.objects.filter(user_id=user_id).delete()
        TfsaAnnualLimit.objects.filter(user_id=user_id).delete()
        AppSetting.objects.filter(
            user_id=user_id,
            key__in=["tfsa_opening_balance", "tfsa_opening_balance_base_year"],
        ).delete()


def create_tfsa_transfer(
    user_id,
    from_tfsa_account_id,
    to_tfsa_account_id,
    transfer_date,
    amount,
    memo,
):
    if from_tfsa_account_id == to_tfsa_account_id:
        raise ValueError("Source and destination accounts must be different")
    if amount <= 0:
        raise ValueError("amount must be > 0")
    if not transfer_date:
        raise ValueError("transfer_date required")

    from_account = TfsaAccount.objects.filter(id=from_tfsa_account_id, user_id=user_id).first()
    to_account = TfsaAccount.objects.filter(id=to_tfsa_account_id, user_id=user_id).first()
    if not from_account:
        raise ValueError("Source account not found")
    if not to_account:
        raise ValueError("Destination account not found")

    user_memo = str(memo or "").strip()
    from_memo = f"[Transfer to {to_account.account_name}]"
    to_memo = f"[Transfer from {from_account.account_name}]"
    if user_memo:
        from_memo = f"{from_memo} {user_memo}"
        to_memo = f"{to_memo} {user_memo}"

    with transaction.atomic():
        TfsaContribution.objects.create(
            user_id=user_id,
            tfsa_account_id=from_tfsa_account_id,
            contribution_date=transfer_date,
            amount=amount,
            contribution_type="Withdrawal",
            memo=from_memo,
        )
        TfsaContribution.objects.create(
            user_id=user_id,
            tfsa_account_id=to_tfsa_account_id,
            contribution_date=transfer_date,
            amount=amount,
            contribution_type="Deposit",
            memo=to_memo,
        )


def get_tfsa_summary(user_id):
    accounts = list(
        TfsaAccount.objects.filter(user_id=user_id)
        .order_by("-created_at")
        .values("id", "account_name")
    )

    opening_balance = get_user_tfsa_opening_balance(user_id)
    opening_balance_base_year = get_user_tfsa_opening_balance_base_year(user_id)
    opening_balance_configured = is_user_tfsa_opening_balance_configured(user_id)
    annual_limits = list_effective_tfsa_annual_limits(user_id)
    current_year = datetime.now().year

    annual_limit_map = _build_annual_limit_map(annual_limits)

    account_rows = TfsaContribution.objects.filter(user_id=user_id).values(
        "tfsa_account_id", "contribution_type", "amount"
    )

    room_rows = TfsaContribution.objects.filter(user_id=user_id).order_by("contribution_date", "id").values(
        "contribution_date", "contribution_type", "amount", "memo"
    )

    contrib_map = {}
    total_deposits = 0
    total_withdrawals = 0

    for contrib in account_rows:
        account_id = contrib["tfsa_account_id"]
        if account_id not in contrib_map:
            contrib_map[account_id] = {"deposits": 0, "withdrawals": 0}

        amount = float(contrib["amount"] or 0)
        if contrib["contribution_type"] == "Deposit":
            contrib_map[account_id]["deposits"] += amount
            total_deposits += amount
        elif contrib["contribution_type"] == "Withdrawal":
            contrib_map[account_id]["withdrawals"] += amount
            total_withdrawals += amount

    summary = []
    for acc in accounts:
        contrib = contrib_map.get(acc["id"], {"deposits": 0, "withdrawals": 0})
        account_used = contrib["deposits"] - contrib["withdrawals"]
        summary.append(
            {
                "id": acc["id"],
                "account_name": acc["account_name"],
                "deposits": contrib["deposits"],
                "withdrawals": contrib["withdrawals"],
                "used": account_used,
            }
        )

    room_deposits = 0
    room_withdrawals_eligible = 0
    room_withdrawals_pending = 0

    for row in room_rows:
        memo = str(row["memo"] or "")
        if _is_transfer_memo(memo):
            continue

        contribution_type = str(row["contribution_type"] or "")
        amount = float(row["amount"] or 0)
        try:
            contribution_year = int(str(row["contribution_date"] or "")[:4])
        except (TypeError, ValueError):
            contribution_year = current_year

        if contribution_type == "Deposit":
            room_deposits += amount
        elif contribution_type == "Withdrawal":
            if contribution_year < current_year:
                room_withdrawals_eligible += amount
            else:
                room_withdrawals_pending += amount

    total_used = total_deposits - total_withdrawals
    room_used = room_deposits - room_withdrawals_eligible

    include_base_year_annual_limit = _resolve_include_base_year_annual_limit(
        opening_balance=opening_balance,
        base_year=opening_balance_base_year,
        annual_limit_map=annual_limit_map,
        evaluated_year=current_year,
        room_used=room_used,
    )

    minimum_annual_year = None
    if opening_balance_base_year is not None:
        minimum_annual_year = int(opening_balance_base_year) + (0 if include_base_year_annual_limit else 1)

    candidate_annual_limits = annual_limits
    if minimum_annual_year is not None:
        candidate_annual_limits = [limit for limit in annual_limits if int(limit["year"]) >= minimum_annual_year]

    available_annual_limits = [limit for limit in candidate_annual_limits if int(limit["year"]) <= current_year]
    future_annual_limits = [limit for limit in candidate_annual_limits if int(limit["year"]) > current_year]
    total_annual_room = sum(limit["annual_limit"] for limit in available_annual_limits)
    total_future_annual_room = sum(limit["annual_limit"] for limit in future_annual_limits)
    total_available_room = opening_balance + total_annual_room

    total_remaining = total_available_room - room_used
    taxable_excess_amount = max(0.0, -total_remaining)
    over_contribution_amount = taxable_excess_amount
    is_over_contributed = over_contribution_amount > ROOM_EPSILON

    return {
        "accounts": summary,
        "opening_balance": opening_balance,
        "opening_balance_base_year": opening_balance_base_year,
        "opening_balance_configured": opening_balance_configured,
        "current_year": current_year,
        "minimum_annual_year": minimum_annual_year,
        "annual_limits": annual_limits,
        "available_annual_limits": available_annual_limits,
        "future_annual_limits": future_annual_limits,
        "total_annual_room": total_annual_room,
        "total_future_annual_room": total_future_annual_room,
        "total_available_room": total_available_room,
        "total_deposits": total_deposits,
        "total_withdrawals": total_withdrawals,
        "total_used": total_used,
        "room_deposits": room_deposits,
        "room_withdrawals_eligible": room_withdrawals_eligible,
        "room_withdrawals_pending": room_withdrawals_pending,
        "room_used": room_used,
        "total_remaining": max(0, total_remaining),
        "taxable_excess_amount": taxable_excess_amount,
        "over_contribution_amount": over_contribution_amount,
        "is_over_contributed": is_over_contributed,
        "base_year_annual_room_included": include_base_year_annual_limit,
    }


def validate_tfsa_deposit_room_for_date(user_id, amount, contribution_date, *, exclude_transaction_id=None):
    normalized_amount = float(amount or 0)
    if normalized_amount <= 0:
        raise ValueError("amount must be > 0")

    target_year = _coerce_year(contribution_date)
    if target_year is None:
        raise ValueError("contribution_date must be in YYYY-MM-DD format")

    opening_balance = get_user_tfsa_opening_balance(user_id)
    opening_balance_base_year = get_user_tfsa_opening_balance_base_year(user_id)
    annual_limits = list_effective_tfsa_annual_limits(user_id)
    annual_limit_map = _build_annual_limit_map(annual_limits)

    room_rows = TfsaContribution.objects.filter(user_id=user_id)
    if exclude_transaction_id is not None:
        room_rows = room_rows.exclude(id=exclude_transaction_id)

    room_rows = room_rows.order_by("contribution_date", "id").values(
        "contribution_date", "contribution_type", "amount", "memo"
    )

    room_deposits_to_year = 0.0
    room_withdrawals_eligible_to_year = 0.0
    for row in room_rows:
        if _is_transfer_memo(row.get("memo")):
            continue

        contribution_year = _coerce_year(row.get("contribution_date"))
        if contribution_year is None:
            continue

        contribution_type = str(row.get("contribution_type") or "")
        value = float(row.get("amount") or 0)

        if contribution_type == "Deposit" and contribution_year <= target_year:
            room_deposits_to_year += value
        elif contribution_type == "Withdrawal" and contribution_year < target_year:
            room_withdrawals_eligible_to_year += value

    room_used_before = room_deposits_to_year - room_withdrawals_eligible_to_year

    include_base_year_annual_limit = _resolve_include_base_year_annual_limit(
        opening_balance=opening_balance,
        base_year=opening_balance_base_year,
        annual_limit_map=annual_limit_map,
        evaluated_year=target_year,
        room_used=room_used_before,
    )

    minimum_annual_year = None
    if opening_balance_base_year is not None:
        minimum_annual_year = int(opening_balance_base_year) + (0 if include_base_year_annual_limit else 1)

    candidate_annual_limits = annual_limits
    if minimum_annual_year is not None:
        candidate_annual_limits = [limit for limit in annual_limits if int(limit["year"]) >= minimum_annual_year]

    available_annual_limits = [limit for limit in candidate_annual_limits if int(limit["year"]) <= target_year]
    total_annual_room = sum(limit["annual_limit"] for limit in available_annual_limits)

    total_available_room_at_target_year = opening_balance + total_annual_room
    remaining_before = total_available_room_at_target_year - room_used_before
    projected_remaining = remaining_before - normalized_amount

    return {
        "valid": projected_remaining >= 0,
        "remaining_before": max(0.0, remaining_before),
        "projected_remaining": max(0.0, projected_remaining),
        "projected_taxable_excess_amount": max(0.0, -projected_remaining),
        "effective_year": target_year,
    }