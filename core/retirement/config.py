import json
from pathlib import Path
from typing import Any, Dict


def get_config_path() -> Path:
    candidates = [
        Path(__file__).resolve().parent.parent.parent / "config" / "tax_constants_qc_2026.json",
        Path("config/tax_constants_qc_2026.json"),
        Path("/app/config/tax_constants_qc_2026.json"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("Could not locate tax_constants_qc_2026.json")


def load_raw_tax_constants() -> Dict[str, Any]:
    path = get_config_path()
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class TaxConstantsIndexed:
    def __init__(self, raw: Dict[str, Any], inflation_rate: float, year_t: int):
        self.raw = raw
        self.inflation_rate = float(inflation_rate)
        self.t = int(year_t)
        self.factor = (1.0 + self.inflation_rate) ** self.t

    def scale(self, amount: float) -> float:
        if amount is None:
            return None
        return float(amount) * self.factor

    # Federal
    @property
    def federal_credit_conversion_rate(self) -> float:
        return float(self.raw["federal"]["credit_conversion_rate"])

    @property
    def federal_brackets(self):
        brackets = []
        for b in self.raw["federal"]["brackets"]:
            thresh = self.scale(b["threshold"]) if b["threshold"] is not None else None
            brackets.append((thresh, float(b["rate"])))
        return brackets

    @property
    def federal_bpa_base(self) -> float:
        return self.scale(self.raw["federal"]["basic_personal_amount"]["base"])

    @property
    def federal_bpa_min(self) -> float:
        return self.scale(self.raw["federal"]["basic_personal_amount"]["minimum"])

    @property
    def federal_bpa_phase_out_start(self) -> float:
        return self.scale(self.raw["federal"]["basic_personal_amount"]["phase_out_start"])

    @property
    def federal_bpa_phase_out_end(self) -> float:
        return self.scale(self.raw["federal"]["basic_personal_amount"]["phase_out_end"])

    @property
    def federal_age_amount_max(self) -> float:
        return self.scale(self.raw["federal"]["age_amount"]["max_amount"])

    @property
    def federal_age_amount_threshold(self) -> float:
        return self.scale(self.raw["federal"]["age_amount"]["clawback_threshold"])

    @property
    def federal_age_amount_clawback_rate(self) -> float:
        return float(self.raw["federal"]["age_amount"]["clawback_rate"])

    @property
    def federal_pension_income_credit_max(self) -> float:
        # SPEC 4.3: unindexed $2,000
        return float(self.raw["federal"]["pension_income_credit_max"])

    @property
    def federal_metc_fixed_threshold(self) -> float:
        return self.scale(self.raw["federal"]["metc"]["fixed_threshold"])

    @property
    def federal_dividend_gross_up(self) -> float:
        return float(self.raw["federal"]["dividend_tax_credit"]["gross_up_factor"])

    @property
    def federal_dividend_credit_rate(self) -> float:
        return float(self.raw["federal"]["dividend_tax_credit"]["credit_rate"])

    @property
    def quebec_abatement_rate(self) -> float:
        return float(self.raw["federal"]["quebec_abatement_rate"])

    @property
    def oas_clawback_threshold(self) -> float:
        return self.scale(self.raw["federal"]["oas_clawback"]["threshold"])

    @property
    def oas_clawback_rate(self) -> float:
        return float(self.raw["federal"]["oas_clawback"]["rate"])

    @property
    def gis_single_income_threshold(self) -> float:
        return self.scale(self.raw["federal"]["gis"]["single_income_threshold"])

    @property
    def gis_clawback_rate(self) -> float:
        return float(self.raw["federal"]["gis"]["clawback_rate"])

    # Quebec
    @property
    def quebec_credit_conversion_rate(self) -> float:
        return float(self.raw["quebec"]["credit_conversion_rate"])

    @property
    def quebec_brackets(self):
        brackets = []
        for b in self.raw["quebec"]["brackets"]:
            thresh = self.scale(b["threshold"]) if b["threshold"] is not None else None
            brackets.append((thresh, float(b["rate"])))
        return brackets

    @property
    def quebec_bpa(self) -> float:
        return self.scale(self.raw["quebec"]["basic_personal_amount"])

    @property
    def quebec_line_361_age_base(self) -> float:
        return self.scale(self.raw["quebec"]["line_361"]["age_amount_base"])

    @property
    def quebec_line_361_retirement_max(self) -> float:
        return self.scale(self.raw["quebec"]["line_361"]["retirement_income_base_max"])

    @property
    def quebec_line_361_reduction_threshold(self) -> float:
        return self.scale(self.raw["quebec"]["line_361"]["reduction_threshold"])

    @property
    def quebec_line_361_reduction_rate(self) -> float:
        return float(self.raw["quebec"]["line_361"]["reduction_rate"])

    @property
    def quebec_dividend_credit_rate(self) -> float:
        return float(self.raw["quebec"]["dividend_tax_credit"]["credit_rate"])

    @property
    def ramq_max_premium(self) -> float:
        return self.scale(self.raw["quebec"]["ramq_prescription_drug"]["max_premium_per_person"])

    @property
    def home_support_rate(self) -> float:
        return float(self.raw["quebec"]["home_support_70_plus"]["gross_credit_rate"])

    @property
    def home_support_cap_autonomous_single(self) -> float:
        return self.scale(self.raw["quebec"]["home_support_70_plus"]["expense_caps"]["autonomous_single"])

    @property
    def home_support_cap_autonomous_couple(self) -> float:
        return self.scale(self.raw["quebec"]["home_support_70_plus"]["expense_caps"]["autonomous_couple"])

    @property
    def home_support_cap_non_autonomous_single(self) -> float:
        return self.scale(self.raw["quebec"]["home_support_70_plus"]["expense_caps"]["non_autonomous_single"])

    @property
    def home_support_cap_non_autonomous_couple(self) -> float:
        return self.scale(self.raw["quebec"]["home_support_70_plus"]["expense_caps"]["non_autonomous_couple"])

    @property
    def home_support_threshold_1(self) -> float:
        return self.scale(self.raw["quebec"]["home_support_70_plus"]["income_thresholds"]["threshold_1"])

    @property
    def home_support_threshold_2(self) -> float:
        return self.scale(self.raw["quebec"]["home_support_70_plus"]["income_thresholds"]["threshold_2"])

    @property
    def home_support_reduction_rate_1(self) -> float:
        return float(self.raw["quebec"]["home_support_70_plus"]["reduction_rates"]["tier_1"])

    @property
    def home_support_reduction_rate_2_autonomous(self) -> float:
        return float(self.raw["quebec"]["home_support_70_plus"]["reduction_rates"]["tier_2_autonomous"])

    @property
    def solidarity_single_base(self) -> float:
        return self.scale(self.raw["quebec"]["solidarity_credit"]["single_base"])

    @property
    def solidarity_couple_base(self) -> float:
        return self.scale(self.raw["quebec"]["solidarity_credit"]["couple_base"])

    @property
    def solidarity_threshold(self) -> float:
        return self.scale(self.raw["quebec"]["solidarity_credit"]["threshold_single"])

    @property
    def solidarity_reduction_rate(self) -> float:
        return float(self.raw["quebec"]["solidarity_credit"]["reduction_rate"])

    # Pensions
    @property
    def qpp_max_annual_at_65(self) -> float:
        return self.scale(self.raw["pensions"]["qpp"]["max_annual_at_65"])

    @property
    def qpp_death_benefit(self) -> float:
        # Fixed statutory death benefit
        return float(self.raw["pensions"]["qpp"]["death_benefit"])

    @property
    def oas_max_annual_at_65(self) -> float:
        return self.scale(self.raw["pensions"]["oas"]["max_annual_at_65"])

    # Accounts
    @property
    def rrsp_annual_ceiling(self) -> float:
        return self.scale(self.raw["accounts"]["rrsp"]["annual_limit_2026"])

    @property
    def tfsa_annual_limit(self) -> float:
        # SPEC 2.3: Index underlying unrounded limit by inflation and round to nearest $500 increment
        unrounded = self.scale(self.raw["accounts"]["tfsa"]["annual_limit_2026"])
        inc = self.raw["accounts"]["tfsa"]["rounding_increment"]
        return round(unrounded / inc) * inc

    def get_rrif_factor(self, age: int) -> float:
        if age < 71:
            return 1.0 / float(90 - age)
        factors = self.raw["accounts"]["rrif_factors"]
        if age >= 95:
            return float(factors.get("95", 0.20))
        return float(factors.get(str(age), 0.20))

    # Estate
    @property
    def liquidation_allowance_notarized(self) -> float:
        return self.scale(self.raw["estate"]["liquidation_allowance_notarized"])

    @property
    def will_verification_fee_non_notarized(self) -> float:
        return self.scale(self.raw["estate"]["will_verification_fee_non_notarized"])

