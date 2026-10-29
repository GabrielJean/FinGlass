from typing import Dict, List, Optional, Tuple
from .config import TaxConstantsIndexed
from .models import (
    AccountBalances,
    HouseholdProfile,
    LumpyEvent,
    PersonProfile,
    SpendingProfile,
    StrategyConfig,
)
from .accounts import (
    StatutoryAccountState,
    calculate_rrif_minimum,
    calculate_lif_minimum,
    sell_non_registered,
    deposit_non_registered,
    process_real_estate_year,
)
from .tax import (
    calculate_individual_tax,
    optimize_pension_income_splitting,
    TaxCalculationResult,
)


def get_lumpy_cash_flows_for_year(
    lumpy_events: List[LumpyEvent],
    age: int,
    constants: TaxConstantsIndexed,
) -> Tuple[float, float, float]:
    """
    Module 8: Irregular / Lumpy Cash-Flow Ledger
    Returns: (tax_free_inflows, taxable_inflows, lumpy_outflows)
    """
    tax_free_inflows = 0.0
    taxable_inflows = 0.0
    lumpy_outflows = 0.0

    for ev in lumpy_events:
        applies = False
        if ev.recurrence == "ONE_TIME":
            if ev.target_age is not None and ev.target_age == age:
                applies = True
        elif ev.recurrence == "RECURRING_INTERVAL":
            s_age = ev.start_age or 0
            e_age = ev.end_age or 100
            interval = ev.interval_years or 1
            if s_age <= age <= e_age:
                if (age - s_age) % interval == 0:
                    applies = True

        if applies:
            indexed_amt = ev.amount * constants.factor
            if ev.type == "INFLOW_TAX_FREE":
                tax_free_inflows += indexed_amt
            elif ev.type == "INFLOW_TAXABLE":
                taxable_inflows += indexed_amt
            elif ev.type in ("OUTFLOW_EXPENSE", "OUTFLOW_GIFT"):
                lumpy_outflows += indexed_amt

    return tax_free_inflows, taxable_inflows, lumpy_outflows


def calculate_target_after_tax_spending(
    spending: SpendingProfile,
    age: int,
    lumpy_outflows: float,
    has_rpa_transition: bool,
    constants: TaxConstantsIndexed,
) -> Tuple[float, float]:
    """
    Module 5.1 & Module 9.1: Target after-tax spending across three phases + RPA + lumpy outflows.
    Returns: (target_after_tax_spending, home_care_expenses_for_credit)
    """
    # Three-phase curve in base 2026 dollars
    if age < 75:
        base_spending = spending.go_go_spending
    elif age < 85:
        base_spending = spending.slow_go_spending
    else:
        base_spending = spending.no_go_spending

    care_expenses = 0.0

    # RPA Transition
    if has_rpa_transition and spending.rpa_transition_age and age >= spending.rpa_transition_age:
        annual_rpa = spending.monthly_rpa_rent * 12.0
        # In RPA, housing/food costs shift to RPA rent
        base_spending = max(base_spending, annual_rpa)
        care_expenses = annual_rpa * spending.rpa_care_portion_pct * constants.factor

    # Total real spending scaled by inflation factor
    total_spending = (base_spending * constants.factor) + lumpy_outflows
    return total_spending, care_expenses


def solve_annual_cash_flow(
    year_t: int,
    t: int,
    age_primary: int,
    age_spouse: Optional[int],
    household: HouseholdProfile,
    state: StatutoryAccountState,
    spending: SpendingProfile,
    strategy: StrategyConfig,
    lumpy_events: List[LumpyEvent],
    inflows_primary: dict,
    inflows_spouse: dict,
    constants: TaxConstantsIndexed,
) -> dict:
    """
    Module 5.2: Annual Cash-Flow Solver & RRSP Meltdown Fixed-Point Loop
    """
    is_couple = household.marital_status == "COUPLE" and age_spouse is not None

    # Check downsizing event
    if spending.rpa_transition_age and age_primary >= spending.rpa_transition_age and not state.has_downsized:
        # Trigger sale of primary residence
        if state.primary_residence_value > 0:
            costs = state.primary_residence_value * 0.05
            net_proceeds = max(0.0, state.primary_residence_value - costs - state.mortgage_balance)
            state.primary_residence_value = 0.0
            state.mortgage_balance = 0.0
            state.has_downsized = True

            # Deposit into TFSA first up to room, remainder to non-reg
            if net_proceeds > 0:
                tfsa_dep = min(net_proceeds, state.tfsa_room)
                state.tfsa_balance += tfsa_dep
                state.tfsa_room = max(0.0, state.tfsa_room - tfsa_dep)
                rem_dep = net_proceeds - tfsa_dep
                if rem_dep > 0:
                    state.non_reg_market_value, state.non_reg_acb = deposit_non_registered(
                        state.non_reg_market_value, state.non_reg_acb, rem_dep
                    )

    # Lumpy cash flows
    tax_free_lumpy, taxable_lumpy, lumpy_outflows = get_lumpy_cash_flows_for_year(
        lumpy_events, age_primary, constants
    )

    # Target spending
    has_rpa = bool(spending.rpa_transition_age and age_primary >= spending.rpa_transition_age)
    target_spending, home_care_expenses = calculate_target_after_tax_spending(
        spending, age_primary, lumpy_outflows, has_rpa, constants
    )

    # Step 1: Forced Inflows
    emp_p = inflows_primary.get("employment", 0.0)
    emp_s = inflows_spouse.get("employment", 0.0) if is_couple else 0.0

    qpp_p = inflows_primary.get("qpp", 0.0)
    qpp_s = inflows_spouse.get("qpp", 0.0) if is_couple else 0.0

    oas_p = inflows_primary.get("oas_gross", 0.0)
    oas_s = inflows_spouse.get("oas_gross", 0.0) if is_couple else 0.0

    gis_p = inflows_primary.get("gis", 0.0)
    gis_s = inflows_spouse.get("gis", 0.0) if is_couple else 0.0

    db_p = inflows_primary.get("db_pension", 0.0)
    db_s = inflows_spouse.get("db_pension", 0.0) if is_couple else 0.0

    # Non-registered annual yields
    non_reg_interest = state.non_reg_market_value * 0.010
    non_reg_dividends = state.non_reg_market_value * 0.025

    # Mandatory RRIF and LIF minimum withdrawals
    rrif_min_p = calculate_rrif_minimum(state.rrsp_balance, age_primary, constants)
    lif_min_p = calculate_lif_minimum(state.lif_balance, age_primary, constants)

    rrif_min_s = calculate_rrif_minimum(state.spouse_rrsp_balance, age_spouse, constants) if is_couple else 0.0
    lif_min_s = calculate_lif_minimum(state.spouse_lif_balance, age_spouse, constants) if is_couple else 0.0

    # Track withdrawals
    reg_withdrawn_p = rrif_min_p + lif_min_p
    reg_withdrawn_s = rrif_min_s + lif_min_s
    non_reg_withdrawn = 0.0
    non_reg_cap_gain = 0.0
    tfsa_withdrawn_p = 0.0
    tfsa_withdrawn_s = 0.0

    # Step 2: RRSP Meltdown Strategy Overlay
    if strategy.mode == "RRSP_MELTDOWN":
        if strategy.target_taxable_ceiling_type == "OAS_CLAWBACK":
            ceiling = constants.oas_clawback_threshold
        else:  # "BRACKET_2"
            ceiling = constants.quebec_brackets[0][0]  # bottom of 2nd bracket ($54,345 indexed)

        forced_inc_p = emp_p + qpp_p + oas_p + db_p + reg_withdrawn_p + non_reg_interest + (non_reg_dividends * 1.38)
        if forced_inc_p < ceiling:
            top_up_room = ceiling - forced_inc_p
            available_reg = state.rrsp_balance + state.lif_balance - reg_withdrawn_p
            extra_reg = min(max(0.0, available_reg), top_up_room)
            reg_withdrawn_p += extra_reg

    # Step 3: Iterative Tax & Deficit Convergence Loop (max 15 iterations)
    tax_res_p = None
    tax_res_s = None
    cash_gap = 0.0

    for iteration in range(15):
        # Taxable capital gains inclusion
        inc_rate = strategy.capital_gains_inclusion_rate
        taxable_cg = non_reg_cap_gain * inc_rate

        p_tax_input = {
            "age": age_primary,
            "earned_income": emp_p,
            "qpp": qpp_p,
            "oas_gross": oas_p,
            "db_pension": db_p,
            "rrif_lif_withdrawals": reg_withdrawn_p,
            "interest": non_reg_interest,
            "eligible_dividends": non_reg_dividends,
            "taxable_capital_gains": taxable_cg,
            "rrsp_deduction": 0.0,
            "medical_expenses": 0.0,
            "has_private_drug_insurance": household.has_private_drug_insurance,
            "is_autonomous_senior": household.is_autonomous_senior,
            "home_care_expenses": home_care_expenses,
        }

        if is_couple:
            s_tax_input = {
                "age": age_spouse,
                "earned_income": emp_s,
                "qpp": qpp_s,
                "oas_gross": oas_s,
                "db_pension": db_s,
                "rrif_lif_withdrawals": reg_withdrawn_s,
                "interest": 0.0,
                "eligible_dividends": 0.0,
                "taxable_capital_gains": 0.0,
                "rrsp_deduction": 0.0,
                "medical_expenses": 0.0,
                "has_private_drug_insurance": household.has_private_drug_insurance,
                "is_autonomous_senior": household.is_autonomous_senior,
                "home_care_expenses": 0.0,
            }

            if strategy.enable_pension_splitting:
                best_s, tax_res_p, tax_res_s = optimize_pension_income_splitting(
                    p_tax_input, s_tax_input, constants
                )
            else:
                fam_inc = p_tax_input["earned_income"] + s_tax_input["earned_income"] + db_p + db_s + qpp_p + qpp_s
                tax_res_p = calculate_individual_tax(
                    family_net_income=fam_inc, is_couple=True, constants=constants, **p_tax_input
                )
                tax_res_s = calculate_individual_tax(
                    family_net_income=fam_inc, is_couple=True, constants=constants, **s_tax_input
                )
            total_tax_and_clawback = tax_res_p.total_tax_and_clawback + tax_res_s.total_tax_and_clawback
        else:
            tax_res_p = calculate_individual_tax(
                family_net_income=p_tax_input["earned_income"] + db_p + qpp_p,
                is_couple=False,
                constants=constants,
                **p_tax_input,
            )
            total_tax_and_clawback = tax_res_p.total_tax_and_clawback

        # Net cash available
        total_gross_inflows = (
            emp_p + emp_s
            + qpp_p + qpp_s
            + oas_p + oas_s
            + gis_p + gis_s
            + db_p + db_s
            + non_reg_interest + non_reg_dividends
            + reg_withdrawn_p + reg_withdrawn_s
            + non_reg_withdrawn
            + tfsa_withdrawn_p + tfsa_withdrawn_s
            + tax_free_lumpy + taxable_lumpy
        )

        net_cash_available = total_gross_inflows - total_tax_and_clawback
        cash_gap = target_spending - net_cash_available

        if abs(cash_gap) <= 1.0:
            break

        if cash_gap > 0:
            # Deficit: draw additional funds according to priority order
            pull_amount = cash_gap

            if strategy.withdrawal_priority == "CLAWBACK_SHIELD":
                # Order B: Non-Registered -> Registered (up to OAS clawback threshold) -> TFSA -> Registered (above threshold)
                # 1. Non-Registered
                if state.non_reg_market_value > non_reg_withdrawn and pull_amount > 0:
                    avail_nr = state.non_reg_market_value - non_reg_withdrawn
                    draw_nr = min(avail_nr, pull_amount)
                    non_reg_withdrawn += draw_nr
                    # Approximate gain on drawn portion
                    if state.non_reg_market_value > 0:
                        non_reg_cap_gain += draw_nr * (1.0 - (state.non_reg_acb / state.non_reg_market_value))
                    pull_amount -= draw_nr

                # 2. Registered up to clawback threshold
                if pull_amount > 0:
                    curr_inc = tax_res_p.net_world_income
                    headroom = max(0.0, constants.oas_clawback_threshold - curr_inc)
                    avail_reg = state.rrsp_balance + state.lif_balance - reg_withdrawn_p
                    draw_reg = min(avail_reg, headroom, pull_amount * 1.35)
                    reg_withdrawn_p += draw_reg
                    pull_amount = max(0.0, pull_amount - draw_reg)

                # 3. TFSA (tax-free)
                if pull_amount > 0 and (state.tfsa_balance > tfsa_withdrawn_p):
                    avail_tfsa = state.tfsa_balance - tfsa_withdrawn_p
                    draw_tfsa = min(avail_tfsa, pull_amount)
                    tfsa_withdrawn_p += draw_tfsa
                    pull_amount -= draw_tfsa

                # 4. Remaining registered above threshold
                if pull_amount > 0:
                    avail_reg = state.rrsp_balance + state.lif_balance - reg_withdrawn_p
                    draw_reg = min(avail_reg, pull_amount * 1.6)
                    reg_withdrawn_p += draw_reg
                    pull_amount = max(0.0, pull_amount - draw_reg)

            else:
                # Order A (Standard): Non-Registered -> Registered -> TFSA
                # 1. Non-Registered
                if state.non_reg_market_value > non_reg_withdrawn and pull_amount > 0:
                    avail_nr = state.non_reg_market_value - non_reg_withdrawn
                    draw_nr = min(avail_nr, pull_amount)
                    non_reg_withdrawn += draw_nr
                    if state.non_reg_market_value > 0:
                        non_reg_cap_gain += draw_nr * (1.0 - (state.non_reg_acb / state.non_reg_market_value))
                    pull_amount -= draw_nr

                # 2. Registered (grossed up for tax)
                if pull_amount > 0:
                    avail_reg = state.rrsp_balance + state.lif_balance - reg_withdrawn_p
                    draw_reg = min(avail_reg, pull_amount * 1.4)
                    reg_withdrawn_p += draw_reg
                    pull_amount = max(0.0, pull_amount - draw_reg)

                # 3. TFSA (0% tax)
                if pull_amount > 0 and (state.tfsa_balance > tfsa_withdrawn_p):
                    avail_tfsa = state.tfsa_balance - tfsa_withdrawn_p
                    draw_tfsa = min(avail_tfsa, pull_amount)
                    tfsa_withdrawn_p += draw_tfsa
                    pull_amount -= draw_tfsa

        elif cash_gap < -1.0:
            # Surplus cash: sweep into TFSA up to room, then Non-Registered
            surplus = abs(cash_gap)
            tfsa_deposit = min(surplus, state.tfsa_room)
            state.tfsa_balance += tfsa_deposit
            state.tfsa_room = max(0.0, state.tfsa_room - tfsa_deposit)
            rem_surplus = surplus - tfsa_deposit
            if rem_surplus > 0:
                state.non_reg_market_value, state.non_reg_acb = deposit_non_registered(
                    state.non_reg_market_value, state.non_reg_acb, rem_surplus
                )
            break

    # Apply withdrawals to balances
    # RRSP / LIF
    if reg_withdrawn_p > 0:
        if state.rrsp_balance >= reg_withdrawn_p:
            state.rrsp_balance -= reg_withdrawn_p
        else:
            rem = reg_withdrawn_p - state.rrsp_balance
            state.rrsp_balance = 0.0
            state.lif_balance = max(0.0, state.lif_balance - rem)

    if is_couple and reg_withdrawn_s > 0:
        if state.spouse_rrsp_balance >= reg_withdrawn_s:
            state.spouse_rrsp_balance -= reg_withdrawn_s
        else:
            rem = reg_withdrawn_s - state.spouse_rrsp_balance
            state.spouse_rrsp_balance = 0.0
            state.spouse_lif_balance = max(0.0, state.spouse_lif_balance - rem)

    # Non-registered
    if non_reg_withdrawn > 0:
        _, _, state.non_reg_acb = sell_non_registered(
            state.non_reg_market_value, state.non_reg_acb, non_reg_withdrawn
        )
        state.non_reg_market_value = max(0.0, state.non_reg_market_value - non_reg_withdrawn)

    # TFSA
    if tfsa_withdrawn_p > 0:
        state.tfsa_balance = max(0.0, state.tfsa_balance - tfsa_withdrawn_p)
    if is_couple and tfsa_withdrawn_s > 0:
        state.spouse_tfsa_balance = max(0.0, state.spouse_tfsa_balance - tfsa_withdrawn_s)

    # Restore TFSA room on Jan 1 of next year
    state.tfsa_room += tfsa_withdrawn_p + constants.tfsa_annual_limit
    if is_couple:
        state.spouse_tfsa_room += tfsa_withdrawn_s + constants.tfsa_annual_limit

    return {
        "reg_withdrawn_p": reg_withdrawn_p,
        "reg_withdrawn_s": reg_withdrawn_s,
        "non_reg_withdrawn": non_reg_withdrawn,
        "non_reg_cap_gain": non_reg_cap_gain,
        "tfsa_withdrawn_p": tfsa_withdrawn_p,
        "tfsa_withdrawn_s": tfsa_withdrawn_s,
        "tax_res_p": tax_res_p,
        "tax_res_s": tax_res_s,
        "target_spending": target_spending,
        "net_cash_available": net_cash_available,
        "cash_gap": cash_gap,
        "home_care_expenses": home_care_expenses,
        "tax_free_lumpy": tax_free_lumpy,
        "taxable_lumpy": taxable_lumpy,
        "non_reg_interest": non_reg_interest,
        "non_reg_dividends": non_reg_dividends,
    }
