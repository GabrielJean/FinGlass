import json
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_GET, require_http_methods, require_POST
from django.contrib.auth.decorators import login_required

from core.models import RetirementPlan
from core.retirement import (
    load_raw_tax_constants,
    PersonProfile,
    HouseholdProfile,
    AssetAllocation,
    AccountBalances,
    MacroAssumptions,
    SpendingProfile,
    LumpyEvent,
    StrategyConfig,
    SimulationParameters,
    run_retirement_simulation,
    export_audit_csv_string,
)


def _read_json(request):
    try:
        if not request.body:
            return {}
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}


def parse_simulation_parameters(data: dict) -> SimulationParameters:
    if not isinstance(data, dict):
        data = {}

    h_data = data.get("household", {})
    prim_data = h_data.get("primary", {})
    sp_data = h_data.get("spouse")

    primary = PersonProfile(
        name=prim_data.get("name", "Primary"),
        birth_year=int(prim_data.get("birth_year", 1966)),
        current_age=int(prim_data.get("current_age", 60)),
        retirement_age=int(prim_data.get("retirement_age", 65)),
        life_expectancy_age=int(prim_data.get("life_expectancy_age", 95)),
        earned_income_current=float(prim_data.get("earned_income_current", 85000.0)),
        qpp_monthly_at_65=float(prim_data.get("qpp_monthly_at_65", 1507.65)),
        qpp_start_age=int(prim_data.get("qpp_start_age", 65)),
        years_in_canada=int(prim_data.get("years_in_canada", 40)),
        oas_start_age=int(prim_data.get("oas_start_age", 65)),
        db_pension_annual=float(prim_data.get("db_pension_annual", 0.0)),
        db_bridge_annual=float(prim_data.get("db_bridge_annual", 0.0)),
        db_indexation=prim_data.get("db_indexation", "FULL_CPI"),
    )

    spouse = None
    if h_data.get("marital_status") == "COUPLE" and sp_data:
        spouse = PersonProfile(
            name=sp_data.get("name", "Spouse"),
            birth_year=int(sp_data.get("birth_year", 1968)),
            current_age=int(sp_data.get("current_age", 58)),
            retirement_age=int(sp_data.get("retirement_age", 65)),
            life_expectancy_age=int(sp_data.get("life_expectancy_age", 95)),
            earned_income_current=float(sp_data.get("earned_income_current", 60000.0)),
            qpp_monthly_at_65=float(sp_data.get("qpp_monthly_at_65", 1100.0)),
            qpp_start_age=int(sp_data.get("qpp_start_age", 65)),
            years_in_canada=int(sp_data.get("years_in_canada", 40)),
            oas_start_age=int(sp_data.get("oas_start_age", 65)),
            db_pension_annual=float(sp_data.get("db_pension_annual", 0.0)),
            db_bridge_annual=float(sp_data.get("db_bridge_annual", 0.0)),
            db_indexation=sp_data.get("db_indexation", "FULL_CPI"),
        )

    household = HouseholdProfile(
        marital_status=h_data.get("marital_status", "SINGLE"),
        primary=primary,
        spouse=spouse,
        has_private_drug_insurance=bool(h_data.get("has_private_drug_insurance", False)),
        is_autonomous_senior=bool(h_data.get("is_autonomous_senior", True)),
        has_notarized_will=bool(h_data.get("has_notarized_will", True)),
    )

    macro_data = data.get("macro", {})
    macro = MacroAssumptions(
        general_inflation=float(macro_data.get("general_inflation", 0.021)),
        wage_growth=float(macro_data.get("wage_growth", 0.031)),
        real_estate_appreciation=float(macro_data.get("real_estate_appreciation", 0.031)),
    )

    alloc_data = data.get("allocation", {})
    allocation = AssetAllocation(
        cash=float(alloc_data.get("cash", 0.05)),
        fixed_income=float(alloc_data.get("fixed_income", 0.35)),
        canadian_equities=float(alloc_data.get("canadian_equities", 0.20)),
        us_equities=float(alloc_data.get("us_equities", 0.25)),
        intl_equities=float(alloc_data.get("intl_equities", 0.15)),
        mer=float(alloc_data.get("mer", 0.002)),
    )

    acc_data = data.get("accounts", {})
    accounts = AccountBalances(
        rrsp=float(acc_data.get("rrsp", 350000.0)),
        lif=float(acc_data.get("lif", 0.0)),
        tfsa=float(acc_data.get("tfsa", 95000.0)),
        tfsa_room=float(acc_data.get("tfsa_room", 7000.0)),
        spouse_rrsp=float(acc_data.get("spouse_rrsp", 0.0)),
        spouse_lif=float(acc_data.get("spouse_lif", 0.0)),
        spouse_tfsa=float(acc_data.get("spouse_tfsa", 0.0)),
        spouse_tfsa_room=float(acc_data.get("spouse_tfsa_room", 0.0)),
        non_reg_market_value=float(acc_data.get("non_reg_market_value", 120000.0)),
        non_reg_acb=float(acc_data.get("non_reg_acb", 90000.0)),
        interest_yield=float(acc_data.get("interest_yield", 0.010)),
        eligible_dividend_yield=float(acc_data.get("eligible_dividend_yield", 0.025)),
        capital_growth_rate=float(acc_data.get("capital_growth_rate", 0.025)),
        primary_residence_value=float(acc_data.get("primary_residence_value", 650000.0)),
        mortgage_balance=float(acc_data.get("mortgage_balance", 100000.0)),
        mortgage_rate=float(acc_data.get("mortgage_rate", 0.045)),
        annual_mortgage_payment=float(acc_data.get("annual_mortgage_payment", 12000.0)),
        secondary_property_value=float(acc_data.get("secondary_property_value", 0.0)),
        secondary_property_acb=float(acc_data.get("secondary_property_acb", 0.0)),
        downsize_age=int(acc_data["downsize_age"]) if acc_data.get("downsize_age") else None,
        transaction_cost_pct=float(acc_data.get("transaction_cost_pct", 0.05)),
        post_downsize_annual_rent=float(acc_data.get("post_downsize_annual_rent", 0.0)),
        term_life_coverage=float(acc_data.get("term_life_coverage", 0.0)),
        term_life_expiry_age=int(acc_data.get("term_life_expiry_age", 70)),
        permanent_life_coverage=float(acc_data.get("permanent_life_coverage", 0.0)),
    )

    sp_cfg = data.get("spending", {})
    spending = SpendingProfile(
        go_go_spending=float(sp_cfg.get("go_go_spending", 60000.0)),
        slow_go_spending=float(sp_cfg.get("slow_go_spending", 52000.0)),
        no_go_spending=float(sp_cfg.get("no_go_spending", 46000.0)),
        rpa_transition_age=int(sp_cfg["rpa_transition_age"]) if sp_cfg.get("rpa_transition_age") else None,
        monthly_rpa_rent=float(sp_cfg.get("monthly_rpa_rent", 4500.0)),
        rpa_care_portion_pct=float(sp_cfg.get("rpa_care_portion_pct", 0.40)),
    )

    strat_data = data.get("strategy", {})
    strategy = StrategyConfig(
        mode=strat_data.get("mode", "STANDARD"),
        target_taxable_ceiling_type=strat_data.get("target_taxable_ceiling_type", "BRACKET_2"),
        withdrawal_priority=strat_data.get("withdrawal_priority", "STANDARD"),
        enable_pension_splitting=bool(strat_data.get("enable_pension_splitting", True)),
        capital_gains_inclusion_rate=float(strat_data.get("capital_gains_inclusion_rate", 0.50)),
        stress_first_death_age=int(strat_data["stress_first_death_age"]) if strat_data.get("stress_first_death_age") else None,
        crash_replay_enabled=bool(strat_data.get("crash_replay_enabled", False)),
        cash_wedge_years=int(strat_data.get("cash_wedge_years", 0)),
    )

    lumpy_events = []
    for ev in data.get("lumpy_events", []):
        if isinstance(ev, dict) and ev.get("amount"):
            lumpy_events.append(
                LumpyEvent(
                    id=str(ev.get("id", "")),
                    label=str(ev.get("label", "Expense")),
                    type=str(ev.get("type", "OUTFLOW_EXPENSE")),
                    amount=float(ev.get("amount", 0.0)),
                    recurrence=str(ev.get("recurrence", "ONE_TIME")),
                    target_age=int(ev["target_age"]) if ev.get("target_age") is not None else None,
                    start_age=int(ev["start_age"]) if ev.get("start_age") is not None else None,
                    end_age=int(ev["end_age"]) if ev.get("end_age") is not None else None,
                    interval_years=int(ev["interval_years"]) if ev.get("interval_years") is not None else None,
                )
            )

    return SimulationParameters(
        household=household,
        macro=macro,
        allocation=allocation,
        accounts=accounts,
        spending=spending,
        lumpy_events=lumpy_events,
        strategy=strategy,
    )


@require_http_methods(["GET", "PUT"])
def retirement_plan_endpoint(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    plan, _ = RetirementPlan.objects.get_or_create(
        user=request.user,
        defaults={"name": "My Quebec Retirement Plan", "plan_data": {}},
    )

    if request.method == "GET":
        return JsonResponse({
            "id": plan.id,
            "name": plan.name,
            "plan_data": plan.plan_data or {},
            "updated_at": plan.updated_at.isoformat(),
        })

    payload = _read_json(request)
    if "name" in payload:
        plan.name = str(payload["name"]).strip() or "My Quebec Retirement Plan"
    if "plan_data" in payload and isinstance(payload["plan_data"], dict):
        plan.plan_data = payload["plan_data"]
    plan.save()

    return JsonResponse({
        "id": plan.id,
        "name": plan.name,
        "plan_data": plan.plan_data,
        "updated_at": plan.updated_at.isoformat(),
    })


@require_POST
def retirement_simulate_endpoint(request):
    payload = _read_json(request)
    plan_data = payload.get("plan_data") or payload
    params = parse_simulation_parameters(plan_data)

    include_comparison = bool(payload.get("include_comparison", True))
    include_monte_carlo = bool(payload.get("include_monte_carlo", True))

    result = run_retirement_simulation(
        params,
        include_comparison=include_comparison,
        include_monte_carlo=include_monte_carlo,
    )
    return JsonResponse(result)


@require_POST
def retirement_export_csv_endpoint(request):
    payload = _read_json(request)
    plan_data = payload.get("plan_data") or payload
    params = parse_simulation_parameters(plan_data)

    result = run_retirement_simulation(params, include_comparison=False, include_monte_carlo=False)
    csv_content = export_audit_csv_string(result.get("audit_table", []))

    response = HttpResponse(csv_content, content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="quebec_retirement_audit_2026.csv"'
    return response


@require_GET
def retirement_config_endpoint(request):
    try:
        constants = load_raw_tax_constants()
        return JsonResponse(constants)
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=500)
