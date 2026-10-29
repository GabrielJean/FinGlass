from typing import Optional
from .config import TaxConstantsIndexed
from .models import PersonProfile


def calculate_qpp_annual(
    profile: PersonProfile,
    age_t: int,
    t: int,
    constants: TaxConstantsIndexed,
    prior_employment_income: float = 0.0,
) -> float:
    """
    Module 3.1: Quebec Pension Plan (QPP / RRQ)
    - Start age: 60 to 72.
    - Base monthly at 65 (2026 dollars), scaled by inflation.
    - Early (60-64): -0.6% per month (up to -36% at 60).
    - Deferred (65-72): +0.7% per month (up to +42% at 70, +58.8% at 72).
    - Post-retirement benefit: +0.5% of prior employment income if working while receiving QPP.
    """
    if age_t < profile.qpp_start_age:
        return 0.0

    base_annual_2026 = profile.qpp_monthly_at_65 * 12.0
    # Cap at statutory maximum for 2026
    base_annual_2026 = min(base_annual_2026, constants.raw["pensions"]["qpp"]["max_annual_at_65"])

    months_delta = (profile.qpp_start_age - 65) * 12
    if months_delta < 0:
        # Early penalty: 0.6% per month
        adj_factor = 1.0 - (0.006 * abs(months_delta))
        adj_factor = max(adj_factor, 0.64)  # max -36%
    elif months_delta > 0:
        # Deferral bonus: 0.7% per month
        adj_factor = 1.0 + (0.007 * months_delta)
    else:
        adj_factor = 1.0

    annual_benefit_base = base_annual_2026 * adj_factor
    # Scale by general inflation
    annual_benefit_indexed = annual_benefit_base * constants.factor

    # Post-retirement benefit: +0.5% of prior year pensionable earnings if working while collecting
    if prior_employment_income > 0.0 and age_t > profile.qpp_start_age:
        prb_rate = float(constants.raw["pensions"]["qpp"]["post_retirement_rate"])
        annual_benefit_indexed += prior_employment_income * prb_rate

    return annual_benefit_indexed


def calculate_oas_gross_annual(
    profile: PersonProfile,
    age_t: int,
    t: int,
    constants: TaxConstantsIndexed,
) -> float:
    """
    Module 3.2: Old Age Security (OAS / SV)
    - Base annualized max at 65 ($9,041 in 2026).
    - Scaled by residency fraction min(1.0, yearsInCanada / 40.0).
    - Deferral bonus (65-70): +0.6% per month (max +36% at 70).
    - Age 75+ step-up: 1.10 multiplier (+10%).
    """
    if age_t < profile.oas_start_age or profile.oas_start_age < 65:
        return 0.0

    residency_ratio = min(1.0, max(0.0, profile.years_in_canada / 40.0))
    base_oas = constants.oas_max_annual_at_65 * residency_ratio

    # Deferral bonus up to age 70
    months_delayed = max(0, min(60, (profile.oas_start_age - 65) * 12))
    deferral_factor = 1.0 + (0.006 * months_delayed)

    gross_oas = base_oas * deferral_factor

    # Age 75+ permanent 10% increase
    if age_t >= 75:
        gross_oas *= float(constants.raw["pensions"]["oas"]["age_75_step_up_multiplier"])

    return gross_oas


def calculate_gis_annual(
    age_t: int,
    net_world_income_non_oas: float,
    constants: TaxConstantsIndexed,
) -> float:
    """
    Module 3.2: Guaranteed Income Supplement (GIS / SRG)
    - For low-income seniors aged 65+.
    - Tested on non-OAS income against federal single threshold ($22,272 indexed).
    - 50 cents per dollar clawback.
    """
    if age_t < 65:
        return 0.0

    threshold = constants.gis_single_income_threshold
    rate = constants.gis_clawback_rate

    # If non-OAS income is below threshold, calculate GIS entitlement
    # Max GIS is approximately 50% of threshold
    max_gis = threshold * rate
    clawback = max(0.0, net_world_income_non_oas * rate)
    return max(0.0, max_gis - clawback)


def calculate_db_pension_annual(
    profile: PersonProfile,
    age_t: int,
    t: int,
    constants: TaxConstantsIndexed,
) -> float:
    """
    Module 3.3: Defined Benefit (DB) Employer Pension (e.g., RREGOP)
    - baseAnnualBenefit: from retirementAge onwards.
    - bridgeBenefit: paid ONLY while retirementAge <= Age_t < 65.
    - indexationFormula: NONE, FULL_CPI, or PARTIAL_CPI.
    """
    if age_t < profile.retirement_age:
        return 0.0

    # Indexation factor
    if profile.db_indexation == "NONE":
        index_factor = 1.0
    elif profile.db_indexation == "PARTIAL_CPI":
        # e.g. 50% of inflation
        index_factor = (1.0 + (constants.inflation_rate * 0.50)) ** t
    else:  # FULL_CPI
        index_factor = constants.factor

    lifetime_part = profile.db_pension_annual * index_factor

    bridge_part = 0.0
    if age_t < 65 and profile.db_bridge_annual > 0:
        bridge_part = profile.db_bridge_annual * index_factor

    return lifetime_part + bridge_part

