from dataclasses import dataclass
from typing import Tuple, Optional
from .config import TaxConstantsIndexed


@dataclass
class StatutoryAccountState:
    # Primary
    rrsp_balance: float
    lif_balance: float
    tfsa_balance: float
    tfsa_room: float

    # Spouse
    spouse_rrsp_balance: float
    spouse_lif_balance: float
    spouse_tfsa_balance: float
    spouse_tfsa_room: float

    # Non-registered
    non_reg_market_value: float
    non_reg_acb: float

    # Real Estate
    primary_residence_value: float
    mortgage_balance: float
    secondary_property_value: float
    secondary_property_acb: float
    has_downsized: bool = False


def calculate_rrif_minimum(balance: float, age: int, constants: TaxConstantsIndexed) -> float:
    if balance <= 0 or age < 71:
        return 0.0
    factor = constants.get_rrif_factor(age)
    return balance * factor


def calculate_lif_minimum(balance: float, age: int, constants: TaxConstantsIndexed) -> float:
    if balance <= 0:
        return 0.0
    factor = constants.get_rrif_factor(age)
    return balance * factor


def sell_non_registered(
    market_value: float,
    acb: float,
    sale_amount: float,
) -> Tuple[float, float, float]:
    """
    Module 2.4: Selling non-registered securities triggers capital gain and adjusts ACB.
    Returns: (actual_sold, capital_gain, new_acb)
    """
    if market_value <= 0 or sale_amount <= 0:
        return 0.0, 0.0, acb

    actual_sold = min(market_value, sale_amount)
    fraction = actual_sold / market_value
    cost_portion = acb * fraction
    capital_gain = max(0.0, actual_sold - cost_portion)
    new_acb = max(0.0, acb - cost_portion)

    return actual_sold, capital_gain, new_acb


def deposit_non_registered(
    market_value: float,
    acb: float,
    deposit_amount: float,
) -> Tuple[float, float]:
    """
    Module 2.4: Purchases / Reinvestments increase both MV and ACB.
    """
    if deposit_amount <= 0:
        return market_value, acb
    return market_value + deposit_amount, acb + deposit_amount


def process_real_estate_year(
    residence_value: float,
    mortgage_balance: float,
    mortgage_rate: float,
    annual_mortgage_payment: float,
    secondary_value: float,
    real_estate_growth: float,
) -> Tuple[float, float, float]:
    """
    Module 2.5: Real estate appreciation and mortgage amortization
    """
    # Appreciation
    new_res_value = residence_value * (1.0 + real_estate_growth)
    new_sec_value = secondary_value * (1.0 + real_estate_growth)

    # Mortgage amortization
    new_mortgage = mortgage_balance
    if mortgage_balance > 0:
        interest_charge = mortgage_balance * mortgage_rate
        principal_paid = max(0.0, annual_mortgage_payment - interest_charge)
        new_mortgage = max(0.0, mortgage_balance - principal_paid)

    return new_res_value, new_mortgage, new_sec_value
