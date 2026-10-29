import csv
import io
from typing import Dict, List, Optional, Tuple

from .config import load_raw_tax_constants, TaxConstantsIndexed
from .models import (
    AccountBalances,
    ExecutiveScorecard,
    HouseholdProfile,
    PersonProfile,
    SimulationParameters,
    SimulationResult,
    StrategyComparison,
    StrategyConfig,
    YearlyAuditRow,
)
from .accounts import (
    StatutoryAccountState,
    process_real_estate_year,
)
from .pensions import (
    calculate_qpp_annual,
    calculate_oas_gross_annual,
    calculate_gis_annual,
    calculate_db_pension_annual,
)
from .cashflow import solve_annual_cash_flow
from .estate import (
    compute_terminal_estate,
    execute_spousal_rollover_first_death,
)
from .monte_carlo import run_monte_carlo_simulation, MonteCarloSimulationResult


def run_deterministic_projection(
    params: SimulationParameters,
    raw_constants: dict,
) -> Tuple[List[YearlyAuditRow], ExecutiveScorecard]:
    """
    Runs the multi-year discrete retirement simulation (Modules 1–6, 8, 9, 11).
    """
    prim = params.household.primary
    sp = params.household.spouse
    is_couple = params.household.marital_status == "COUPLE" and sp is not None

    current_age = prim.current_age
    life_expectancy = prim.life_expectancy_age
    n_years = max(1, life_expectancy - current_age + 1)
    base_calendar_year = raw_constants.get("base_tax_year", 2026)

    inflation = params.macro.general_inflation
    r_net = params.allocation.get_portfolio_expected_return(params.macro)
    re_growth = params.macro.real_estate_appreciation

    # Initial state
    acc = params.accounts
    state = StatutoryAccountState(
        rrsp_balance=float(acc.rrsp),
        lif_balance=float(acc.lif),
        tfsa_balance=float(acc.tfsa),
        tfsa_room=float(acc.tfsa_room),
        spouse_rrsp_balance=float(acc.spouse_rrsp) if is_couple else 0.0,
        spouse_lif_balance=float(acc.spouse_lif) if is_couple else 0.0,
        spouse_tfsa_balance=float(acc.spouse_tfsa) if is_couple else 0.0,
        spouse_tfsa_room=float(acc.spouse_tfsa_room) if is_couple else 0.0,
        non_reg_market_value=float(acc.non_reg_market_value),
        non_reg_acb=float(acc.non_reg_acb),
        primary_residence_value=float(acc.primary_residence_value),
        mortgage_balance=float(acc.mortgage_balance),
        secondary_property_value=float(acc.secondary_property_value),
        secondary_property_acb=float(acc.secondary_property_acb),
        has_downsized=False,
    )

    household_state = HouseholdProfile(
        marital_status=params.household.marital_status,
        primary=prim,
        spouse=sp,
        has_private_drug_insurance=params.household.has_private_drug_insurance,
        is_autonomous_senior=params.household.is_autonomous_senior,
        has_notarized_will=params.household.has_notarized_will,
    )

    yearly_rows: List[YearlyAuditRow] = []
    total_fed_tax = 0.0
    total_qc_tax = 0.0
    total_oas_clawback = 0.0
    total_after_tax_income = 0.0
    shortfall_age = None
    first_death_occurred = False

    for t in range(n_years):
        year = base_calendar_year + t
        age_p = current_age + t
        age_s = (sp.current_age + t) if is_couple and sp else None

        constants_t = TaxConstantsIndexed(raw_constants, inflation, t)

        # Module 11: Survivor & First Death Rules
        # Triggered either by stress_first_death_age or reaching spouse life expectancy
        death_triggered_now = False
        if is_couple and not first_death_occurred:
            if params.strategy.stress_first_death_age and age_p >= params.strategy.stress_first_death_age:
                death_triggered_now = True
            elif sp and age_s >= sp.life_expectancy_age:
                death_triggered_now = True

        if death_triggered_now and not first_death_occurred:
            # First death occurs in year t
            first_death_occurred = True
            execute_spousal_rollover_first_death(state, survivor_is_primary=True)
            # Switch to single in year t+1
            household_state.marital_status = "SINGLE"
            household_state.spouse = None

        # Check employment income
        emp_p = prim.earned_income_current * constants_t.factor if age_p < prim.retirement_age else 0.0
        emp_s = (sp.earned_income_current * constants_t.factor if sp and age_s < sp.retirement_age else 0.0) if is_couple and not first_death_occurred else 0.0

        # Government Pensions
        qpp_p = calculate_qpp_annual(prim, age_p, t, constants_t)
        qpp_s = (calculate_qpp_annual(sp, age_s, t, constants_t) if sp else 0.0) if is_couple and not first_death_occurred else 0.0

        # If death occurred, survivor combined QPP cap (Module 11.3)
        if first_death_occurred:
            # Survivor pension plus own pension capped at max QPP at 65
            max_qpp_cap = constants_t.qpp_max_annual_at_65
            qpp_p = min(qpp_p + (qpp_s * 0.60), max_qpp_cap)
            qpp_s = 0.0

        oas_p = calculate_oas_gross_annual(prim, age_p, t, constants_t)
        oas_s = (calculate_oas_gross_annual(sp, age_s, t, constants_t) if sp else 0.0) if is_couple and not first_death_occurred else 0.0

        db_p = calculate_db_pension_annual(prim, age_p, t, constants_t)
        db_s = (calculate_db_pension_annual(sp, age_s, t, constants_t) if sp else 0.0) if is_couple and not first_death_occurred else 0.0

        # Preliminary GIS
        non_oas_inc_p = emp_p + qpp_p + db_p
        gis_p = calculate_gis_annual(age_p, non_oas_inc_p, constants_t)
        gis_s = calculate_gis_annual(age_s, emp_s + qpp_s + db_s, constants_t) if is_couple and not first_death_occurred and age_s else 0.0

        inflows_p = {
            "employment": emp_p,
            "qpp": qpp_p,
            "oas_gross": oas_p,
            "gis": gis_p,
            "db_pension": db_p,
        }
        inflows_s = {
            "employment": emp_s,
            "qpp": qpp_s,
            "oas_gross": oas_s,
            "gis": gis_s,
            "db_pension": db_s,
        }

        # Solve annual cash flow and tax convergence
        cf = solve_annual_cash_flow(
            year_t=year,
            t=t,
            age_primary=age_p,
            age_spouse=age_s if is_couple and not first_death_occurred else None,
            household=household_state,
            state=state,
            spending=params.spending,
            strategy=params.strategy,
            lumpy_events=params.lumpy_events,
            inflows_primary=inflows_p,
            inflows_spouse=inflows_s,
            constants=constants_t,
        )

        tax_p = cf["tax_res_p"]
        tax_s = cf["tax_res_s"]

        fed_tax_p = tax_p.net_federal_tax if tax_p else 0.0
        fed_tax_s = tax_s.net_federal_tax if tax_s else 0.0
        qc_tax_p = tax_p.net_quebec_tax if tax_p else 0.0
        qc_tax_s = tax_s.net_quebec_tax if tax_s else 0.0
        claw_p = tax_p.oas_clawback if tax_p else 0.0
        claw_s = tax_s.oas_clawback if tax_s else 0.0
        home_supp = (tax_p.home_support_credit if tax_p else 0.0) + (tax_s.home_support_credit if tax_s else 0.0)
        ramq = (tax_p.ramq_premium if tax_p else 0.0) + (tax_s.ramq_premium if tax_s else 0.0)

        tot_tax_year = fed_tax_p + fed_tax_s + qc_tax_p + qc_tax_s + claw_p + claw_s

        total_fed_tax += (fed_tax_p + fed_tax_s)
        total_qc_tax += (qc_tax_p + qc_tax_s)
        total_oas_clawback += (claw_p + claw_s)
        total_after_tax_income += cf["net_cash_available"]

        # Apply multi-year compounding to remaining balances (after withdrawals)
        state.rrsp_balance *= (1.0 + r_net)
        state.lif_balance *= (1.0 + r_net)
        state.tfsa_balance *= (1.0 + r_net)

        if is_couple and not first_death_occurred:
            state.spouse_rrsp_balance *= (1.0 + r_net)
            state.spouse_lif_balance *= (1.0 + r_net)
            state.spouse_tfsa_balance *= (1.0 + r_net)

        # Non-registered price growth (MV grows, ACB stays same)
        state.non_reg_market_value *= (1.0 + 0.025)

        # Real estate
        state.primary_residence_value, state.mortgage_balance, state.secondary_property_value = process_real_estate_year(
            state.primary_residence_value,
            state.mortgage_balance,
            acc.mortgage_rate,
            acc.annual_mortgage_payment,
            state.secondary_property_value,
            re_growth,
        )

        liquid_nw = (
            state.rrsp_balance
            + state.lif_balance
            + state.tfsa_balance
            + state.spouse_rrsp_balance
            + state.spouse_lif_balance
            + state.spouse_tfsa_balance
            + state.non_reg_market_value
        )
        total_nw = (
            liquid_nw
            + max(0.0, state.primary_residence_value - state.mortgage_balance)
            + state.secondary_property_value
        )

        if liquid_nw <= 0.0 and shortfall_age is None and age_p >= prim.retirement_age:
            shortfall_age = age_p

        row = YearlyAuditRow(
            year=year,
            t=t,
            age_primary=age_p,
            age_spouse=age_s if is_couple and not first_death_occurred else None,
            employment_income=emp_p + emp_s,
            qpp_primary=qpp_p,
            qpp_spouse=qpp_s,
            oas_gross_primary=oas_p,
            oas_gross_spouse=oas_s,
            gis_primary=gis_p,
            gis_spouse=gis_s,
            db_pension_primary=db_p,
            db_pension_spouse=db_s,
            non_reg_interest=cf["non_reg_interest"],
            non_reg_dividends=cf["non_reg_dividends"],
            lumpy_inflows=cf["tax_free_lumpy"] + cf["taxable_lumpy"],
            rrsp_withdrawal_primary=cf["reg_withdrawn_p"],
            rrsp_withdrawal_spouse=cf["reg_withdrawn_s"],
            lif_withdrawal_primary=0.0,
            lif_withdrawal_spouse=0.0,
            non_reg_withdrawal=cf["non_reg_withdrawn"],
            non_reg_capital_gain=cf["non_reg_cap_gain"],
            tfsa_withdrawal_primary=cf["tfsa_withdrawn_p"],
            tfsa_withdrawal_spouse=cf["tfsa_withdrawn_s"],
            total_income_primary=tax_p.total_income if tax_p else 0.0,
            total_income_spouse=tax_s.total_income if tax_s else 0.0,
            taxable_income_primary=tax_p.taxable_income if tax_p else 0.0,
            taxable_income_spouse=tax_s.taxable_income if tax_s else 0.0,
            federal_tax_primary=fed_tax_p,
            federal_tax_spouse=fed_tax_s,
            quebec_tax_primary=qc_tax_p,
            quebec_tax_spouse=qc_tax_s,
            oas_clawback_primary=claw_p,
            oas_clawback_spouse=claw_s,
            home_support_credit_qc=home_supp,
            ramq_premium_qc=ramq,
            total_taxes_and_clawbacks=tot_tax_year,
            target_after_tax_spending=cf["target_spending"],
            actual_after_tax_cash=cf["net_cash_available"],
            cash_gap=cf["cash_gap"],
            rrsp_balance_primary=state.rrsp_balance,
            rrsp_balance_spouse=state.spouse_rrsp_balance,
            lif_balance_primary=state.lif_balance,
            lif_balance_spouse=state.spouse_lif_balance,
            tfsa_balance_primary=state.tfsa_balance,
            tfsa_balance_spouse=state.spouse_tfsa_balance,
            non_reg_market_value=state.non_reg_market_value,
            non_reg_acb=state.non_reg_acb,
            primary_residence_value=state.primary_residence_value,
            mortgage_balance=state.mortgage_balance,
            secondary_property_value=state.secondary_property_value,
            total_net_worth=total_nw,
            liquid_net_worth=liquid_nw,
        )
        yearly_rows.append(row)

    # Final year estate calculation (Module 6)
    constants_final = TaxConstantsIndexed(raw_constants, inflation, n_years - 1)
    terminal_res = compute_terminal_estate(
        age=life_expectancy,
        state=state,
        household=household_state,
        accounts_cfg=acc,
        strategy=params.strategy,
        constants=constants_final,
    )

    plan_success = shortfall_age is None
    avg_monthly_income = (total_after_tax_income / float(n_years * 12)) if n_years > 0 else 0.0

    scorecard = ExecutiveScorecard(
        plan_success=plan_success,
        shortfall_age=shortfall_age,
        average_monthly_after_tax_income=round(avg_monthly_income, 2),
        total_lifetime_taxes_paid=round(total_fed_tax + total_qc_tax + total_oas_clawback, 2),
        total_federal_tax_paid=round(total_fed_tax, 2),
        total_quebec_tax_paid=round(total_qc_tax, 2),
        total_oas_clawback=round(total_oas_clawback, 2),
        net_after_tax_estate=round(terminal_res.net_after_tax_estate, 2),
        gross_estate_value=round(terminal_res.gross_estate_value, 2),
        terminal_tax_bill=round(terminal_res.terminal_tax_bill, 2),
        estate_liquidity_warning=terminal_res.estate_liquidity_warning,
    )

    return yearly_rows, scorecard


def run_retirement_simulation(
    params: SimulationParameters,
    include_comparison: bool = True,
    include_monte_carlo: bool = True,
) -> Dict[str, any]:
    """
    Main engine API entry point.
    Runs baseline and optionally optimized scenario, plus Monte Carlo.
    """
    raw_constants = load_raw_tax_constants()

    # 1. Primary simulation run
    yearly_rows, scorecard = run_deterministic_projection(params, raw_constants)

    comparison_data = None
    if include_comparison:
        # Compare Baseline vs. Optimized scenario
        # If current strategy is STANDARD, optimized is RRSP_MELTDOWN
        # If current strategy is RRSP_MELTDOWN, baseline is STANDARD
        baseline_params = SimulationParameters(
            household=params.household,
            macro=params.macro,
            allocation=params.allocation,
            accounts=params.accounts,
            spending=params.spending,
            lumpy_events=params.lumpy_events,
            strategy=StrategyConfig(
                mode="STANDARD",
                withdrawal_priority="STANDARD",
                enable_pension_splitting=params.strategy.enable_pension_splitting,
                capital_gains_inclusion_rate=params.strategy.capital_gains_inclusion_rate,
            ),
        )
        opt_params = SimulationParameters(
            household=params.household,
            macro=params.macro,
            allocation=params.allocation,
            accounts=params.accounts,
            spending=params.spending,
            lumpy_events=params.lumpy_events,
            strategy=StrategyConfig(
                mode="RRSP_MELTDOWN",
                target_taxable_ceiling_type="BRACKET_2",
                withdrawal_priority="CLAWBACK_SHIELD",
                enable_pension_splitting=params.strategy.enable_pension_splitting,
                capital_gains_inclusion_rate=params.strategy.capital_gains_inclusion_rate,
            ),
        )

        _, base_scorecard = run_deterministic_projection(baseline_params, raw_constants)
        _, opt_scorecard = run_deterministic_projection(opt_params, raw_constants)

        taxes_saved = base_scorecard.total_lifetime_taxes_paid - opt_scorecard.total_lifetime_taxes_paid
        estate_delta = opt_scorecard.net_after_tax_estate - base_scorecard.net_after_tax_estate

        comparison_data = {
            "baseline_lifetime_taxes": base_scorecard.total_lifetime_taxes_paid,
            "baseline_final_estate": base_scorecard.net_after_tax_estate,
            "optimized_lifetime_taxes": opt_scorecard.total_lifetime_taxes_paid,
            "optimized_final_estate": opt_scorecard.net_after_tax_estate,
            "taxes_saved": round(taxes_saved, 2),
            "final_estate_delta": round(estate_delta, 2),
        }

    mc_result = None
    if include_monte_carlo:
        mc = run_monte_carlo_simulation(params, yearly_rows, num_trials=1000)
        mc_result = {
            "probability_of_success": mc.probability_of_success,
            "total_trials": mc.total_trials,
            "successful_trials": mc.successful_trials,
            "percentiles": mc.percentiles,
            "years": mc.years,
            "crash_replay_success": mc.crash_replay_success,
            "crash_replay_ending_balance": mc.crash_replay_ending_balance,
            "cash_wedge_ending_balance": mc.cash_wedge_ending_balance,
        }

    # Format cash-flow chart series
    cash_flow_series = {
        "labels": [f"{r.year} (Age {r.age_primary})" for r in yearly_rows],
        "qpp": [round(r.qpp_primary + r.qpp_spouse, 2) for r in yearly_rows],
        "oas_gis": [round(r.oas_gross_primary + r.oas_gross_spouse + r.gis_primary + r.gis_spouse, 2) for r in yearly_rows],
        "db_pension": [round(r.db_pension_primary + r.db_pension_spouse, 2) for r in yearly_rows],
        "registered_withdrawals": [round(r.rrsp_withdrawal_primary + r.rrsp_withdrawal_spouse + r.lif_withdrawal_primary + r.lif_withdrawal_spouse, 2) for r in yearly_rows],
        "non_registered_withdrawals": [round(r.non_reg_withdrawal, 2) for r in yearly_rows],
        "tfsa_withdrawals": [round(r.tfsa_withdrawal_primary + r.tfsa_withdrawal_spouse, 2) for r in yearly_rows],
        "target_spending": [round(r.target_after_tax_spending, 2) for r in yearly_rows],
        "taxes_and_clawbacks": [round(r.total_taxes_and_clawbacks, 2) for r in yearly_rows],
        "net_worth": [round(r.total_net_worth, 2) for r in yearly_rows],
    }

    # Format audit table rows
    audit_table = [
        {
            "year": r.year,
            "age_primary": r.age_primary,
            "age_spouse": r.age_spouse,
            "employment_income": round(r.employment_income, 2),
            "qpp": round(r.qpp_primary + r.qpp_spouse, 2),
            "oas_gis": round(r.oas_gross_primary + r.oas_gross_spouse + r.gis_primary + r.gis_spouse, 2),
            "db_pension": round(r.db_pension_primary + r.db_pension_spouse, 2),
            "registered_withdrawals": round(r.rrsp_withdrawal_primary + r.rrsp_withdrawal_spouse, 2),
            "non_reg_withdrawals": round(r.non_reg_withdrawal, 2),
            "tfsa_withdrawals": round(r.tfsa_withdrawal_primary + r.tfsa_withdrawal_spouse, 2),
            "federal_tax": round(r.federal_tax_primary + r.federal_tax_spouse, 2),
            "quebec_tax": round(r.quebec_tax_primary + r.quebec_tax_spouse, 2),
            "oas_clawback": round(r.oas_clawback_primary + r.oas_clawback_spouse, 2),
            "home_support_credit": round(r.home_support_credit_qc, 2),
            "total_tax_and_clawback": round(r.total_taxes_and_clawbacks, 2),
            "target_spending": round(r.target_after_tax_spending, 2),
            "actual_after_tax_cash": round(r.actual_after_tax_cash, 2),
            "rrsp_balance": round(r.rrsp_balance_primary + r.rrsp_balance_spouse, 2),
            "tfsa_balance": round(r.tfsa_balance_primary + r.tfsa_balance_spouse, 2),
            "non_reg_mv": round(r.non_reg_market_value, 2),
            "non_reg_acb": round(r.non_reg_acb, 2),
            "real_estate_net": round(max(0.0, r.primary_residence_value - r.mortgage_balance) + r.secondary_property_value, 2),
            "total_net_worth": round(r.total_net_worth, 2),
        }
        for r in yearly_rows
    ]

    return {
        "scorecard": {
            "plan_success": scorecard.plan_success,
            "shortfall_age": scorecard.shortfall_age,
            "average_monthly_after_tax_income": scorecard.average_monthly_after_tax_income,
            "total_lifetime_taxes_paid": scorecard.total_lifetime_taxes_paid,
            "total_federal_tax_paid": scorecard.total_federal_tax_paid,
            "total_quebec_tax_paid": scorecard.total_quebec_tax_paid,
            "total_oas_clawback": scorecard.total_oas_clawback,
            "net_after_tax_estate": scorecard.net_after_tax_estate,
            "gross_estate_value": scorecard.gross_estate_value,
            "terminal_tax_bill": scorecard.terminal_tax_bill,
            "estate_liquidity_warning": scorecard.estate_liquidity_warning,
        },
        "comparison": comparison_data,
        "cash_flow_series": cash_flow_series,
        "audit_table": audit_table,
        "monte_carlo": mc_result,
    }


def export_audit_csv_string(audit_table: List[dict]) -> str:
    """
    Module 7.4: Exports year-by-year audit table to CSV format.
    """
    output = io.StringIO()
    if not audit_table:
        return ""

    fieldnames = list(audit_table[0].keys())
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for row in audit_table:
        writer.writerow(row)

    return output.getvalue()
