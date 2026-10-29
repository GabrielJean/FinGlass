from dataclasses import dataclass, field
import math
from typing import Any, Dict, List, Optional


@dataclass
class PersonProfile:
    name: str = "Primary"
    birth_year: int = 1966
    current_age: int = 60
    retirement_age: int = 65
    life_expectancy_age: int = 95
    earned_income_current: float = 85000.0
    qpp_monthly_at_65: float = 1507.65
    qpp_start_age: int = 65
    years_in_canada: int = 40
    oas_start_age: int = 65
    db_pension_annual: float = 0.0
    db_bridge_annual: float = 0.0
    db_indexation: str = "FULL_CPI"  # "NONE" | "FULL_CPI" | "PARTIAL_CPI"


@dataclass
class AssetAllocation:
    cash: float = 0.05
    fixed_income: float = 0.35
    canadian_equities: float = 0.20
    us_equities: float = 0.25
    intl_equities: float = 0.15
    mer: float = 0.002

    def get_portfolio_expected_return(self, macro: "MacroAssumptions") -> float:
        gross = (
            self.cash * macro.cash_mu
            + self.fixed_income * macro.fixed_income_mu
            + self.canadian_equities * macro.canadian_equities_mu
            + self.us_equities * macro.us_equities_mu
            + self.intl_equities * macro.intl_equities_mu
        )
        return gross - self.mer

    def get_portfolio_std_dev(self, macro: "MacroAssumptions") -> float:
        var = (
            (self.cash * macro.cash_sigma) ** 2
            + (self.fixed_income * macro.fixed_income_sigma) ** 2
            + (self.canadian_equities * macro.canadian_equities_sigma) ** 2
            + (self.us_equities * macro.us_equities_sigma) ** 2
            + (self.intl_equities * macro.intl_equities_sigma) ** 2
        )
        return math.sqrt(var)


@dataclass
class MacroAssumptions:
    general_inflation: float = 0.021
    wage_growth: float = 0.031
    real_estate_appreciation: float = 0.031
    cash_mu: float = 0.024
    cash_sigma: float = 0.015
    fixed_income_mu: float = 0.032
    fixed_income_sigma: float = 0.060
    canadian_equities_mu: float = 0.063
    canadian_equities_sigma: float = 0.155
    us_equities_mu: float = 0.064
    us_equities_sigma: float = 0.160
    intl_equities_mu: float = 0.066
    intl_equities_sigma: float = 0.170


@dataclass
class AccountBalances:
    # Primary registered
    rrsp: float = 350000.0
    lif: float = 0.0
    tfsa: float = 95000.0
    tfsa_room: float = 7000.0

    # Spouse registered
    spouse_rrsp: float = 0.0
    spouse_lif: float = 0.0
    spouse_tfsa: float = 0.0
    spouse_tfsa_room: float = 0.0

    # Taxable
    non_reg_market_value: float = 120000.0
    non_reg_acb: float = 90000.0
    interest_yield: float = 0.010
    eligible_dividend_yield: float = 0.025
    capital_growth_rate: float = 0.025

    # Real estate
    primary_residence_value: float = 650000.0
    mortgage_balance: float = 100000.0
    mortgage_rate: float = 0.045
    annual_mortgage_payment: float = 12000.0
    secondary_property_value: float = 0.0
    secondary_property_acb: float = 0.0

    # Downsizing
    downsize_age: Optional[int] = None
    transaction_cost_pct: float = 0.05
    post_downsize_annual_rent: float = 0.0

    # Life insurance
    term_life_coverage: float = 0.0
    term_life_expiry_age: int = 70
    permanent_life_coverage: float = 0.0


@dataclass
class SpendingProfile:
    go_go_spending: float = 60000.0  # retirementAge to 74
    slow_go_spending: float = 52000.0  # 75 to 84
    no_go_spending: float = 46000.0  # 85+
    rpa_transition_age: Optional[int] = None
    monthly_rpa_rent: float = 4500.0
    rpa_care_portion_pct: float = 0.40


@dataclass
class LumpyEvent:
    id: str
    label: str
    type: str  # "INFLOW_TAX_FREE" | "INFLOW_TAXABLE" | "OUTFLOW_EXPENSE" | "OUTFLOW_GIFT"
    amount: float
    recurrence: str  # "ONE_TIME" | "RECURRING_INTERVAL"
    target_age: Optional[int] = None
    start_age: Optional[int] = None
    end_age: Optional[int] = None
    interval_years: Optional[int] = None


@dataclass
class StrategyConfig:
    mode: str = "STANDARD"  # "STANDARD" | "RRSP_MELTDOWN"
    target_taxable_ceiling_type: str = "BRACKET_2"  # "BRACKET_2" | "OAS_CLAWBACK"
    withdrawal_priority: str = "STANDARD"  # "STANDARD" | "CLAWBACK_SHIELD"
    enable_pension_splitting: bool = True
    capital_gains_inclusion_rate: float = 0.50
    stress_first_death_age: Optional[int] = None
    crash_replay_enabled: bool = False
    cash_wedge_years: int = 0


@dataclass
class HouseholdProfile:
    marital_status: str = "SINGLE"  # "SINGLE" | "COUPLE"
    primary: PersonProfile = field(default_factory=PersonProfile)
    spouse: Optional[PersonProfile] = None
    has_private_drug_insurance: bool = False
    is_autonomous_senior: bool = True
    has_notarized_will: bool = True


@dataclass
class SimulationParameters:
    household: HouseholdProfile = field(default_factory=HouseholdProfile)
    macro: MacroAssumptions = field(default_factory=MacroAssumptions)
    allocation: AssetAllocation = field(default_factory=AssetAllocation)
    accounts: AccountBalances = field(default_factory=AccountBalances)
    spending: SpendingProfile = field(default_factory=SpendingProfile)
    lumpy_events: List[LumpyEvent] = field(default_factory=list)
    strategy: StrategyConfig = field(default_factory=StrategyConfig)


@dataclass
class YearlyAuditRow:
    year: int
    t: int
    age_primary: int
    age_spouse: Optional[int]

    # Inflows
    employment_income: float
    qpp_primary: float
    qpp_spouse: float
    oas_gross_primary: float
    oas_gross_spouse: float
    gis_primary: float
    gis_spouse: float
    db_pension_primary: float
    db_pension_spouse: float
    non_reg_interest: float
    non_reg_dividends: float
    lumpy_inflows: float

    # Withdrawals
    rrsp_withdrawal_primary: float
    rrsp_withdrawal_spouse: float
    lif_withdrawal_primary: float
    lif_withdrawal_spouse: float
    non_reg_withdrawal: float
    non_reg_capital_gain: float
    tfsa_withdrawal_primary: float
    tfsa_withdrawal_spouse: float

    # Taxes & Clawbacks
    total_income_primary: float
    total_income_spouse: float
    taxable_income_primary: float
    taxable_income_spouse: float
    federal_tax_primary: float
    federal_tax_spouse: float
    quebec_tax_primary: float
    quebec_tax_spouse: float
    oas_clawback_primary: float
    oas_clawback_spouse: float
    home_support_credit_qc: float
    ramq_premium_qc: float
    total_taxes_and_clawbacks: float

    # Target & Spending
    target_after_tax_spending: float
    actual_after_tax_cash: float
    cash_gap: float

    # Balances (End of Year)
    rrsp_balance_primary: float
    rrsp_balance_spouse: float
    lif_balance_primary: float
    lif_balance_spouse: float
    tfsa_balance_primary: float
    tfsa_balance_spouse: float
    non_reg_market_value: float
    non_reg_acb: float
    primary_residence_value: float
    mortgage_balance: float
    secondary_property_value: float
    total_net_worth: float
    liquid_net_worth: float


@dataclass
class ExecutiveScorecard:
    plan_success: bool
    shortfall_age: Optional[int]
    average_monthly_after_tax_income: float
    total_lifetime_taxes_paid: float
    total_federal_tax_paid: float
    total_quebec_tax_paid: float
    total_oas_clawback: float
    net_after_tax_estate: float
    gross_estate_value: float
    terminal_tax_bill: float
    estate_liquidity_warning: bool


@dataclass
class StrategyComparison:
    baseline_lifetime_taxes: float
    baseline_final_estate: float
    optimized_lifetime_taxes: float
    optimized_final_estate: float
    taxes_saved: float
    final_estate_delta: float


@dataclass
class SimulationResult:
    scorecard: ExecutiveScorecard
    yearly_rows: List[YearlyAuditRow]
    comparison: Optional[StrategyComparison] = None
