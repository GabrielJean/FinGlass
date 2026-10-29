from dataclasses import dataclass
from typing import Dict, Tuple, Optional
from .config import TaxConstantsIndexed


@dataclass
class TaxCalculationResult:
    total_income: float
    net_world_income: float
    taxable_income: float
    oas_clawback: float
    federal_gross_tax: float
    federal_non_refundable_credits: float
    basic_federal_tax: float
    federal_quebec_abatement: float
    net_federal_tax: float
    quebec_gross_tax: float
    quebec_non_refundable_credits: float
    basic_quebec_tax: float
    ramq_premium: float
    home_support_credit: float
    solidarity_credit: float
    net_quebec_tax: float
    total_tax_and_clawback: float


def compute_bracket_tax(taxable_income: float, brackets: list) -> float:
    if taxable_income <= 0:
        return 0.0

    tax = 0.0
    lower_limit = 0.0

    for threshold, rate in brackets:
        if threshold is None:
            tax += max(0.0, taxable_income - lower_limit) * rate
            break
        elif taxable_income > threshold:
            tax += (threshold - lower_limit) * rate
            lower_limit = threshold
        else:
            tax += max(0.0, taxable_income - lower_limit) * rate
            break

    return tax


def calculate_home_support_credit(
    age_t: int,
    home_care_expenses: float,
    family_net_income: float,
    is_autonomous: bool,
    is_couple: bool,
    constants: TaxConstantsIndexed,
) -> float:
    """
    Module 9.2: Quebec Refundable Tax Credit for Home-Support Services for Seniors (Age 70+)
    """
    if age_t < 70 or home_care_expenses <= 0:
        return 0.0

    if is_autonomous:
        cap = constants.home_support_cap_autonomous_couple if is_couple else constants.home_support_cap_autonomous_single
    else:
        cap = constants.home_support_cap_non_autonomous_couple if is_couple else constants.home_support_cap_non_autonomous_single

    eligible_expenses = min(home_care_expenses, cap)
    gross_credit = eligible_expenses * constants.home_support_rate

    thresh1 = constants.home_support_threshold_1
    thresh2 = constants.home_support_threshold_2
    reduction = 0.0

    if family_net_income > thresh1:
        tier1_income = min(family_net_income, thresh2) - thresh1
        reduction += tier1_income * constants.home_support_reduction_rate_1

    if is_autonomous and family_net_income > thresh2:
        tier2_income = family_net_income - thresh2
        reduction += tier2_income * constants.home_support_reduction_rate_2_autonomous

    return max(0.0, gross_credit - reduction)


def calculate_ramq_premium(
    net_income: float,
    has_private_drug_insurance: bool,
    constants: TaxConstantsIndexed,
) -> float:
    """
    Module 4.4: RAMQ Prescription Drug Insurance Plan
    If no private insurance, add income-tested premium up to max $789 (indexed).
    """
    if has_private_drug_insurance:
        return 0.0

    max_prem = constants.ramq_max_premium
    # Exemption threshold approx $19,000 indexed, fully phased in around $35,000
    exemption = constants.scale(19000.0)
    phase_in_top = constants.scale(35000.0)

    if net_income <= exemption:
        return 0.0
    if net_income >= phase_in_top:
        return max_prem

    fraction = (net_income - exemption) / (phase_in_top - exemption)
    return min(max_prem, max_prem * fraction)


def calculate_individual_tax(
    age: int,
    earned_income: float,
    qpp: float,
    oas_gross: float,
    db_pension: float,
    rrif_lif_withdrawals: float,
    interest: float,
    eligible_dividends: float,
    taxable_capital_gains: float,
    rrsp_deduction: float,
    medical_expenses: float,
    has_private_drug_insurance: bool,
    family_net_income: float,
    is_autonomous_senior: bool,
    is_couple: bool,
    home_care_expenses: float,
    constants: TaxConstantsIndexed,
) -> TaxCalculationResult:
    """
    Module 4: Dual Tax & Clawback Solver for a Single Individual in Quebec (CRA + Revenu Québec)
    """
    # Gross up eligible dividends by 38%
    grossed_up_dividends = eligible_dividends * constants.federal_dividend_gross_up

    # 4.1 Total, Net & Taxable Income
    total_income = (
        earned_income
        + qpp
        + oas_gross
        + db_pension
        + rrif_lif_withdrawals
        + interest
        + grossed_up_dividends
        + taxable_capital_gains
    )

    net_world_income = max(0.0, total_income - rrsp_deduction)

    # 4.2 OAS Clawback
    oas_clawback = 0.0
    if oas_gross > 0 and net_world_income > constants.oas_clawback_threshold:
        excess = net_world_income - constants.oas_clawback_threshold
        oas_clawback = min(oas_gross, max(0.0, excess * constants.oas_clawback_rate))

    taxable_income = max(0.0, net_world_income - oas_clawback)

    # Eligible pension income: DB at any age, RRIF/LIF at age 65+
    eligible_pension_income = db_pension + (rrif_lif_withdrawals if age >= 65 else 0.0)

    # ---------------- 4.3 Federal Tax ----------------
    federal_gross_tax = compute_bracket_tax(taxable_income, constants.federal_brackets)

    # BPA phase-out
    bpa_base = constants.federal_bpa_base
    bpa_min = constants.federal_bpa_min
    p_start = constants.federal_bpa_phase_out_start
    p_end = constants.federal_bpa_phase_out_end

    if net_world_income <= p_start:
        federal_bpa = bpa_base
    elif net_world_income >= p_end:
        federal_bpa = bpa_min
    else:
        frac = (net_world_income - p_start) / (p_end - p_start)
        federal_bpa = bpa_base - frac * (bpa_base - bpa_min)

    # Age Amount (65+)
    federal_age_amt = 0.0
    if age >= 65:
        base_age = constants.federal_age_amount_max
        excess_age = max(0.0, net_world_income - constants.federal_age_amount_threshold)
        federal_age_amt = max(0.0, base_age - (excess_age * constants.federal_age_amount_clawback_rate))

    # Pension Income Amount
    federal_pension_credit_base = min(eligible_pension_income, constants.federal_pension_income_credit_max)

    # METC
    metc_threshold = min(constants.federal_metc_fixed_threshold, 0.03 * net_world_income)
    federal_metc_base = max(0.0, medical_expenses - metc_threshold)

    # Non-refundable credit pool at 14%
    conv_rate_fed = constants.federal_credit_conversion_rate
    fed_credits_standard = (federal_bpa + federal_age_amt + federal_pension_credit_base + federal_metc_base) * conv_rate_fed

    # Dividend tax credit
    fed_div_credit = grossed_up_dividends * constants.federal_dividend_credit_rate

    total_federal_credits = fed_credits_standard + fed_div_credit
    basic_federal_tax = max(0.0, federal_gross_tax - total_federal_credits)

    # 16.5% Quebec Abatement
    abatement = basic_federal_tax * constants.quebec_abatement_rate
    net_federal_tax = basic_federal_tax - abatement

    # ---------------- 4.4 Quebec Tax ----------------
    quebec_gross_tax = compute_bracket_tax(taxable_income, constants.quebec_brackets)

    # Quebec BPA
    qc_bpa = constants.quebec_bpa

    # Line 361: Age + Retirement Income Amount
    qc_line_361_base = (constants.quebec_line_361_age_base if age >= 65 else 0.0) + min(
        eligible_pension_income, constants.quebec_line_361_retirement_max
    )
    fam_inc = max(net_world_income, family_net_income)
    qc_reduction = max(0.0, (fam_inc - constants.quebec_line_361_reduction_threshold) * constants.quebec_line_361_reduction_rate)
    qc_line_361 = max(0.0, qc_line_361_base - qc_reduction)

    # Quebec METC: medical expenses - 3% of family income
    qc_metc_base = max(0.0, medical_expenses - (0.03 * fam_inc))

    conv_rate_qc = constants.quebec_credit_conversion_rate
    qc_credits_standard = (qc_bpa + qc_line_361 + qc_metc_base) * conv_rate_qc
    qc_div_credit = grossed_up_dividends * constants.quebec_dividend_credit_rate

    total_qc_credits = qc_credits_standard + qc_div_credit
    basic_quebec_tax = max(0.0, quebec_gross_tax - total_qc_credits)

    # RAMQ
    ramq_prem = calculate_ramq_premium(net_world_income, has_private_drug_insurance, constants)

    # Refundable credits
    home_support = calculate_home_support_credit(
        age, home_care_expenses, fam_inc, is_autonomous_senior, is_couple, constants
    )

    # Solidarity credit (income-tested)
    solidarity = 0.0
    if fam_inc < constants.solidarity_threshold:
        solidarity = constants.solidarity_single_base
    else:
        excess_sol = fam_inc - constants.solidarity_threshold
        solidarity = max(0.0, constants.solidarity_single_base - (excess_sol * constants.solidarity_reduction_rate))

    # Net Quebec Tax (can be negative due to refundable credits)
    net_quebec_tax = basic_quebec_tax + ramq_prem - home_support - solidarity

    total_tax_and_clawback = net_federal_tax + net_quebec_tax + oas_clawback

    return TaxCalculationResult(
        total_income=total_income,
        net_world_income=net_world_income,
        taxable_income=taxable_income,
        oas_clawback=oas_clawback,
        federal_gross_tax=federal_gross_tax,
        federal_non_refundable_credits=total_federal_credits,
        basic_federal_tax=basic_federal_tax,
        federal_quebec_abatement=abatement,
        net_federal_tax=net_federal_tax,
        quebec_gross_tax=quebec_gross_tax,
        quebec_non_refundable_credits=total_qc_credits,
        basic_quebec_tax=basic_quebec_tax,
        ramq_premium=ramq_prem,
        home_support_credit=home_support,
        solidarity_credit=solidarity,
        net_quebec_tax=net_quebec_tax,
        total_tax_and_clawback=total_tax_and_clawback,
    )


def optimize_pension_income_splitting(
    primary_data: dict,
    spouse_data: dict,
    constants: TaxConstantsIndexed,
) -> Tuple[float, TaxCalculationResult, TaxCalculationResult]:
    """
    Module 4.5: Eligible Pension Income Splitting Optimizer (Couples Only)
    Grid search over s in [0, 0.50] with 0.05 step to minimize combined household tax & clawback.
    Returns: (best_split_fraction, primary_tax_result, spouse_tax_result)
    """
    # Eligible pension income: DB at any age; RRIF/LIF at age >= 65
    prim_age = primary_data.get("age", 65)
    sp_age = spouse_data.get("age", 65)

    prim_eligible = primary_data.get("db_pension", 0.0) + (
        primary_data.get("rrif_lif_withdrawals", 0.0) if prim_age >= 65 else 0.0
    )
    sp_eligible = spouse_data.get("db_pension", 0.0) + (
        spouse_data.get("rrif_lif_withdrawals", 0.0) if sp_age >= 65 else 0.0
    )

    # Determine transfer direction: higher eligible pension spouse splits to lower
    if prim_eligible >= sp_eligible:
        higher_is_primary = True
        max_transfer = prim_eligible * 0.50
    else:
        higher_is_primary = False
        max_transfer = sp_eligible * 0.50

    best_s = 0.0
    best_combined_tax = float("inf")
    best_res_prim = None
    best_res_sp = None

    steps = [i * 0.05 for i in range(11)]  # 0.0 to 0.50 inclusive

    for s in steps:
        transfer_amount = (prim_eligible if higher_is_primary else sp_eligible) * s

        # Adjust pensions for tax calculation
        p_data = dict(primary_data)
        s_data = dict(spouse_data)

        if higher_is_primary:
            # Primary transfers to spouse
            if p_data.get("db_pension", 0.0) >= transfer_amount:
                p_data["db_pension"] -= transfer_amount
                s_data["db_pension"] = s_data.get("db_pension", 0.0) + transfer_amount
            else:
                rem = transfer_amount - p_data.get("db_pension", 0.0)
                p_data["db_pension"] = 0.0
                p_data["rrif_lif_withdrawals"] = max(0.0, p_data.get("rrif_lif_withdrawals", 0.0) - rem)
                s_data["db_pension"] = s_data.get("db_pension", 0.0) + transfer_amount
        else:
            # Spouse transfers to primary
            if s_data.get("db_pension", 0.0) >= transfer_amount:
                s_data["db_pension"] -= transfer_amount
                p_data["db_pension"] = p_data.get("db_pension", 0.0) + transfer_amount
            else:
                rem = transfer_amount - s_data.get("db_pension", 0.0)
                s_data["db_pension"] = 0.0
                s_data["rrif_lif_withdrawals"] = max(0.0, s_data.get("rrif_lif_withdrawals", 0.0) - rem)
                p_data["db_pension"] = p_data.get("db_pension", 0.0) + transfer_amount

        # Compute preliminary family net income
        fam_inc = p_data.get("earned_income", 0.0) + s_data.get("earned_income", 0.0) + p_data.get("db_pension", 0.0) + s_data.get("db_pension", 0.0) + p_data.get("qpp", 0.0) + s_data.get("qpp", 0.0)

        res_p = calculate_individual_tax(
            family_net_income=fam_inc,
            is_couple=True,
            constants=constants,
            **p_data,
        )
        res_s = calculate_individual_tax(
            family_net_income=fam_inc,
            is_couple=True,
            constants=constants,
            **s_data,
        )

        combined_tax = res_p.total_tax_and_clawback + res_s.total_tax_and_clawback
        if combined_tax < best_combined_tax:
            best_combined_tax = combined_tax
            best_s = s
            best_res_prim = res_p
            best_res_sp = res_s

    return best_s, best_res_prim, best_res_sp
