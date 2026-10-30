from dataclasses import dataclass
from .config import TaxConstantsIndexed
from .models import AccountBalances, HouseholdProfile, StrategyConfig
from .accounts import StatutoryAccountState
from .tax import calculate_individual_tax


@dataclass
class TerminalEstateResult:
    gross_estate_value: float
    terminal_tax_bill: float
    net_after_tax_estate: float
    estate_liquidity_warning: bool
    liquidation_costs: float
    taxable_registered_income: float
    taxable_capital_gains: float
    life_insurance_payout: float


def compute_terminal_estate(
    age: int,
    state: StatutoryAccountState,
    household: HouseholdProfile,
    accounts_cfg: AccountBalances,
    strategy: StrategyConfig,
    constants: TaxConstantsIndexed,
) -> TerminalEstateResult:
    """
    Module 6: Final Estate, Deemed Disposition & Liquidity Engine
    """
    # 1. 100% Registered Deemed Disposition
    total_registered = (
        state.rrsp_balance
        + state.lif_balance
        + state.spouse_rrsp_balance
        + state.spouse_lif_balance
    )

    # 2. Unrealized Capital Gains Deemed Disposition
    non_reg_gain = max(0.0, state.non_reg_market_value - state.non_reg_acb)
    sec_prop_gain = max(0.0, state.secondary_property_value - state.secondary_property_acb)
    total_unrealized_gain = non_reg_gain + sec_prop_gain

    # Inclusion rate
    inc_rate = strategy.capital_gains_inclusion_rate
    if inc_rate > 0.50 and total_unrealized_gain > 250000.0:
        # Tiered 50% on first 250k, 66.67% on excess
        taxable_cap_gain = (250000.0 * 0.50) + ((total_unrealized_gain - 250000.0) * (2.0 / 3.0))
    else:
        taxable_cap_gain = total_unrealized_gain * inc_rate

    # 3. Tax-Free Estate Inflows
    primary_equity = max(0.0, state.primary_residence_value - state.mortgage_balance)
    tfsa_total = state.tfsa_balance + state.spouse_tfsa_balance

    # Life insurance payout
    life_insurance = accounts_cfg.permanent_life_coverage
    if age < accounts_cfg.term_life_expiry_age:
        life_insurance += accounts_cfg.term_life_coverage

    # 4. Quebec Liquidation Settlement Costs
    if household.has_notarized_will:
        liquidation_costs = constants.liquidation_allowance_notarized
    else:
        liquidation_costs = (
            constants.liquidation_allowance_notarized
            + constants.will_verification_fee_non_notarized
        )

    # 5. Terminal Tax Bill Calculation
    terminal_tax_res = calculate_individual_tax(
        age=age,
        earned_income=0.0,
        qpp=0.0,
        oas_gross=0.0,
        db_pension=0.0,
        rrif_lif_withdrawals=total_registered,
        interest=0.0,
        eligible_dividends=0.0,
        taxable_capital_gains=taxable_cap_gain,
        rrsp_deduction=0.0,
        medical_expenses=0.0,
        has_private_drug_insurance=household.has_private_drug_insurance,
        family_net_income=total_registered + taxable_cap_gain,
        is_autonomous_senior=household.is_autonomous_senior,
        is_couple=False,
        home_care_expenses=0.0,
        constants=constants,
    )

    terminal_tax = terminal_tax_res.total_tax_and_clawback

    # Gross Estate Value
    gross_estate = (
        total_registered
        + state.non_reg_market_value
        + primary_equity
        + state.secondary_property_value
        + tfsa_total
        + life_insurance
    )

    # Net Estate for heirs
    net_estate = max(0.0, gross_estate - terminal_tax - liquidation_costs)

    # Liquidity Warning: Tax bill > liquid assets + life insurance
    liquid_assets = (
        state.non_reg_market_value
        + tfsa_total
        + life_insurance
        + (total_registered - terminal_tax if total_registered > terminal_tax else 0.0)
    )
    estate_liquidity_warning = terminal_tax > (state.non_reg_market_value + tfsa_total + life_insurance)

    return TerminalEstateResult(
        gross_estate_value=gross_estate,
        terminal_tax_bill=terminal_tax,
        net_after_tax_estate=net_estate,
        estate_liquidity_warning=estate_liquidity_warning,
        liquidation_costs=liquidation_costs,
        taxable_registered_income=total_registered,
        taxable_capital_gains=taxable_cap_gain,
        life_insurance_payout=life_insurance,
    )


def execute_spousal_rollover_first_death(
    state: StatutoryAccountState,
    survivor_is_primary: bool,
) -> None:
    """
    Module 11.1: Tax-Free Spousal Account Rollover upon first death.
    - Transfer 100% of deceased spouse's RRSP/RRIF/LIF to survivor's RRIF/LIF at 0% tax.
    - Transfer 100% of deceased spouse's TFSA to survivor's TFSA as exempt rollover.
    - Non-Reg assets and secondary property roll over at existing ACB.
    """
    if survivor_is_primary:
        # Spouse died, Primary survives
        state.rrsp_balance += state.spouse_rrsp_balance
        state.lif_balance += state.spouse_lif_balance
        state.tfsa_balance += state.spouse_tfsa_balance

        state.spouse_rrsp_balance = 0.0
        state.spouse_lif_balance = 0.0
        state.spouse_tfsa_balance = 0.0
        state.spouse_tfsa_room = 0.0
    else:
        # Primary died, Spouse survives
        state.spouse_rrsp_balance += state.rrsp_balance
        state.spouse_lif_balance += state.lif_balance
        state.spouse_tfsa_balance += state.tfsa_balance

        state.rrsp_balance = 0.0
        state.lif_balance = 0.0
        state.tfsa_balance = 0.0
        state.tfsa_room = 0.0

