import math
import random
from dataclasses import dataclass
from typing import Dict, List, Tuple
from .models import AssetAllocation, MacroAssumptions, SimulationParameters


def box_muller_normal(mu: float, sigma: float) -> float:
    """
    Generate normal random variable N(mu, sigma^2) using Box-Muller transform.
    """
    u1 = max(1e-12, random.random())
    u2 = random.random()
    z0 = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
    return mu + (sigma * z0)


@dataclass
class MonteCarloSimulationResult:
    probability_of_success: float
    total_trials: int
    successful_trials: int
    percentiles: Dict[str, List[float]]  # "10th", "50th", "90th"
    years: List[int]
    crash_replay_success: bool
    crash_replay_ending_balance: float
    cash_wedge_ending_balance: float


def run_monte_carlo_simulation(
    params: SimulationParameters,
    deterministic_yearly_rows: list,
    num_trials: int = 1000,
    random_seed: int = 42,
) -> MonteCarloSimulationResult:
    """
    Module 10: Sequence-of-Returns Stress Tester (Monte Carlo & Crash Replay)
    """
    random.seed(random_seed)

    mu_port = params.allocation.get_portfolio_expected_return(params.macro)
    sigma_port = params.allocation.get_portfolio_std_dev(params.macro)

    n_years = len(deterministic_yearly_rows)
    if n_years == 0:
        return MonteCarloSimulationResult(
            probability_of_success=100.0,
            total_trials=num_trials,
            successful_trials=num_trials,
            percentiles={"10th": [], "50th": [], "90th": []},
            years=[],
            crash_replay_success=True,
            crash_replay_ending_balance=0.0,
            cash_wedge_ending_balance=0.0,
        )

    # Initial liquid balance
    acc = params.accounts
    initial_liquid = (
        acc.rrsp
        + acc.lif
        + acc.tfsa
        + acc.spouse_rrsp
        + acc.spouse_lif
        + acc.spouse_tfsa
        + acc.non_reg_market_value
    )

    # Extract net withdrawals each year from deterministic run
    # Net portfolio withdrawal = Total gross withdrawals - forced yields
    net_withdrawals = []
    for row in deterministic_yearly_rows:
        total_w = (
            row.rrsp_withdrawal_primary
            + row.rrsp_withdrawal_spouse
            + row.lif_withdrawal_primary
            + row.lif_withdrawal_spouse
            + row.non_reg_withdrawal
            + row.tfsa_withdrawal_primary
            + row.tfsa_withdrawal_spouse
        )
        net_withdrawals.append(max(0.0, total_w))

    # Run M trials
    trajectories = []  # shape: [trial][year]
    successful_count = 0

    for _ in range(num_trials):
        bal = initial_liquid
        traj = []
        is_solvent = True

        for t in range(n_years):
            w = net_withdrawals[t]
            r = box_muller_normal(mu_port, sigma_port)

            # Portfolio growth applied to balance net of half-year withdrawal
            bal = (bal - (w * 0.5)) * (1.0 + r) - (w * 0.5)

            if bal <= 0.0:
                bal = 0.0
                is_solvent = False

            traj.append(bal)

        if bal > 0.0:
            successful_count += 1
        trajectories.append(traj)

    prob_success = (successful_count / float(num_trials)) * 100.0

    # Calculate percentiles across trials for each year
    p10 = []
    p50 = []
    p90 = []

    for t in range(n_years):
        vals = [trajectories[m][t] for m in range(num_trials)]
        vals.sort()
        idx10 = int(0.10 * num_trials)
        idx50 = int(0.50 * num_trials)
        idx90 = int(0.90 * num_trials)
        p10.append(vals[idx10])
        p50.append(vals[idx50])
        p90.append(vals[idx90])

    years_list = [row.year for row in deterministic_yearly_rows]

    # 10.2 Historical Crash Replay & Cash Wedge Buffer
    # Override first 3 years of retirement with [-22%, -8%, +12%]
    ret_idx = max(0, params.household.primary.retirement_age - params.household.primary.current_age)
    crash_returns = {-22: -0.22, -8: -0.08, 12: 0.12}
    crash_seq = [-0.22, -0.08, 0.12]

    bal_crash = initial_liquid
    for t in range(n_years):
        w = net_withdrawals[t]
        if ret_idx <= t < ret_idx + 3:
            r = crash_seq[t - ret_idx]
        else:
            r = mu_port
        bal_crash = (bal_crash - (w * 0.5)) * (1.0 + r) - (w * 0.5)
        if bal_crash < 0.0:
            bal_crash = 0.0

    # Cash Wedge simulation
    # Hold K years in cash wedge (e.g. 2 years) earning 2.4%
    wedge_years = max(1, params.strategy.cash_wedge_years if params.strategy.cash_wedge_years > 0 else 2)
    avg_withdrawal = (sum(net_withdrawals) / float(n_years)) if n_years > 0 else 50000.0
    cash_wedge_target = avg_withdrawal * wedge_years
    cash_wedge_bal = min(initial_liquid * 0.15, cash_wedge_target)
    equity_bal = initial_liquid - cash_wedge_bal
    cash_rate = params.macro.cash_mu

    for t in range(n_years):
        w = net_withdrawals[t]
        if ret_idx <= t < ret_idx + 3:
            r = crash_seq[t - ret_idx]
        else:
            r = mu_port

        if r < 0.0 and cash_wedge_bal > 0:
            # Draw from cash wedge instead of depressed equities
            pull_wedge = min(cash_wedge_bal, w)
            cash_wedge_bal -= pull_wedge
            rem_w = w - pull_wedge
            equity_bal = (equity_bal - rem_w) * (1.0 + r)
        else:
            # Normal draw and replenish cash wedge if positive return
            equity_bal = (equity_bal - (w * 0.5)) * (1.0 + r) - (w * 0.5)
            if r > 0.0 and cash_wedge_bal < cash_wedge_target:
                replenish = min(cash_wedge_target - cash_wedge_bal, equity_bal * 0.05)
                cash_wedge_bal += replenish
                equity_bal -= replenish

        cash_wedge_bal *= (1.0 + cash_rate)

    wedge_final = equity_bal + cash_wedge_bal

    return MonteCarloSimulationResult(
        probability_of_success=round(prob_success, 1),
        total_trials=num_trials,
        successful_trials=successful_count,
        percentiles={
            "10th": p10,
            "50th": p50,
            "90th": p90,
        },
        years=years_list,
        crash_replay_success=bal_crash > 0.0,
        crash_replay_ending_balance=round(bal_crash, 2),
        cash_wedge_ending_balance=round(wedge_final, 2),
    )
