import React, { useEffect, useState, useMemo } from "react";
import { api } from "../api";
import { formatMoney } from "../utils/formatters";
import {
  Compass,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Download,
  RefreshCw,
  Sliders,
  User,
  Users,
  Home,
  ShieldCheck,
  Building,
  HeartPulse,
  Plus,
  Trash2,
  FileSpreadsheet,
  Activity,
} from "lucide-react";
import { Bar, Line } from "react-chartjs-2";
import "../components/charts/chartSetup";
import {
  formatCompactMoney,
  commonTooltipOptions,
  commonScaleOptions,
} from "../components/charts/chartSetup";
import { ChartCard } from "../components/charts/ChartCard";

const DEFAULT_PLAN = {
  name: "My Quebec Retirement Plan",
  household: {
    marital_status: "SINGLE",
    primary: {
      name: "Primary",
      birth_year: 1966,
      current_age: 60,
      retirement_age: 65,
      life_expectancy_age: 95,
      earned_income_current: 85000,
      qpp_monthly_at_65: 1507.65,
      qpp_start_age: 65,
      years_in_canada: 40,
      oas_start_age: 65,
      db_pension_annual: 0,
      db_bridge_annual: 0,
      db_indexation: "FULL_CPI",
    },
    spouse: {
      name: "Spouse",
      birth_year: 1968,
      current_age: 58,
      retirement_age: 65,
      life_expectancy_age: 95,
      earned_income_current: 60000,
      qpp_monthly_at_65: 1100,
      qpp_start_age: 65,
      years_in_canada: 40,
      oas_start_age: 65,
      db_pension_annual: 0,
      db_bridge_annual: 0,
      db_indexation: "FULL_CPI",
    },
    has_private_drug_insurance: false,
    is_autonomous_senior: true,
    has_notarized_will: true,
  },
  accounts: {
    rrsp: 350000,
    lif: 0,
    tfsa: 95000,
    tfsa_room: 7000,
    spouse_rrsp: 180000,
    spouse_lif: 0,
    spouse_tfsa: 75000,
    spouse_tfsa_room: 7000,
    non_reg_market_value: 120000,
    non_reg_acb: 90000,
    interest_yield: 0.01,
    eligible_dividend_yield: 0.025,
    capital_growth_rate: 0.025,
    primary_residence_value: 650000,
    mortgage_balance: 100000,
    mortgage_rate: 0.045,
    annual_mortgage_payment: 12000,
    secondary_property_value: 0,
    secondary_property_acb: 0,
    downsize_age: null,
    transaction_cost_pct: 0.05,
    post_downsize_annual_rent: 0,
    term_life_coverage: 0,
    term_life_expiry_age: 70,
    permanent_life_coverage: 0,
  },
  spending: {
    go_go_spending: 60000,
    slow_go_spending: 52000,
    no_go_spending: 46000,
    rpa_transition_age: null,
    monthly_rpa_rent: 4500,
    rpa_care_portion_pct: 0.4,
  },
  strategy: {
    mode: "RRSP_MELTDOWN",
    target_taxable_ceiling_type: "BRACKET_2",
    withdrawal_priority: "STANDARD",
    enable_pension_splitting: true,
    capital_gains_inclusion_rate: 0.5,
    stress_first_death_age: null,
    crash_replay_enabled: false,
    cash_wedge_years: 2,
  },
  macro: {
    general_inflation: 0.021,
    wage_growth: 0.031,
    real_estate_appreciation: 0.031,
  },
  allocation: {
    cash: 0.05,
    fixed_income: 0.35,
    canadian_equities: 0.2,
    us_equities: 0.25,
    intl_equities: 0.15,
    mer: 0.002,
  },
  lumpy_events: [
    {
      id: "ev1",
      label: "Vehicle Replacement",
      type: "OUTFLOW_EXPENSE",
      amount: 40000,
      recurrence: "RECURRING_INTERVAL",
      start_age: 65,
      end_age: 81,
      interval_years: 8,
    },
  ],
};

export function RetirementView() {
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState("dashboard"); // "dashboard", "inputs", "monte_carlo", "audit"

  const [plan, setPlan] = useState(DEFAULT_PLAN);
  const [simResult, setSimResult] = useState(null);

  // Load existing plan on mount
  useEffect(() => {
    async function loadInitialPlan() {
      setLoading(true);
      setError("");
      try {
        const res = await api.retirement.getPlan();
        if (res && res.plan_data && Object.keys(res.plan_data).length > 0) {
          // Merge with defaults
          setPlan((prev) => ({
            ...prev,
            ...res.plan_data,
            name: res.name || prev.name,
          }));
          await runSimulation(res.plan_data);
        } else {
          await runSimulation(DEFAULT_PLAN);
        }
      } catch (err) {
        setError(err.message || "Failed to load retirement plan.");
      } finally {
        setLoading(false);
      }
    }
    loadInitialPlan();
  }, []);

  const runSimulation = async (planToSimulate) => {
    setSimulating(true);
    try {
      const res = await api.retirement.simulate({
        plan_data: planToSimulate || plan,
        include_comparison: true,
        include_monte_carlo: true,
      });
      setSimResult(res);
    } catch (err) {
      setError(err.message || "Simulation failed.");
    } finally {
      setSimulating(false);
    }
  };

  const handleSavePlan = async () => {
    setError("");
    setNotice("");
    try {
      await api.retirement.savePlan({
        name: plan.name || "My Quebec Retirement Plan",
        plan_data: plan,
      });
      setNotice("Retirement plan parameters saved successfully.");
      await runSimulation(plan);
    } catch (err) {
      setError(err.message || "Failed to save plan.");
    }
  };

  const handleExportCsv = async () => {
    try {
      await api.retirement.exportCsv(plan);
    } catch (err) {
      setError(err.message || "Failed to export CSV.");
    }
  };

  const scorecard = simResult?.scorecard;
  const comparison = simResult?.comparison;
  const cashFlows = simResult?.cash_flow_series;
  const auditTable = simResult?.audit_table || [];
  const monteCarlo = simResult?.monte_carlo;

  // Stacked Bar Cash Flow Chart Data
  const cashFlowChartData = useMemo(() => {
    if (!cashFlows || !cashFlows.labels) return null;

    return {
      labels: cashFlows.labels,
      datasets: [
        {
          type: "line",
          label: "Target After-Tax Spending",
          data: cashFlows.target_spending,
          borderColor: "#38bdf8",
          backgroundColor: "#38bdf8",
          borderWidth: 2.5,
          tension: 0.2,
          yAxisID: "y",
          order: 1,
        },
        {
          type: "line",
          label: "Taxes & OAS Clawbacks",
          data: cashFlows.taxes_and_clawbacks,
          borderColor: "#f87171",
          backgroundColor: "#f87171",
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.2,
          yAxisID: "y",
          order: 2,
        },
        {
          type: "bar",
          label: "QPP Pension",
          data: cashFlows.qpp,
          backgroundColor: "#34d399",
          stack: "inflow",
          order: 3,
        },
        {
          type: "bar",
          label: "OAS & GIS",
          data: cashFlows.oas_gis,
          backgroundColor: "#2dd4bf",
          stack: "inflow",
          order: 4,
        },
        {
          type: "bar",
          label: "DB Pension",
          data: cashFlows.db_pension,
          backgroundColor: "#60a5fa",
          stack: "inflow",
          order: 5,
        },
        {
          type: "bar",
          label: "RRSP/RRIF/LIF",
          data: cashFlows.registered_withdrawals,
          backgroundColor: "#a78bfa",
          stack: "inflow",
          order: 6,
        },
        {
          type: "bar",
          label: "Non-Registered",
          data: cashFlows.non_registered_withdrawals,
          backgroundColor: "#fbbf24",
          stack: "inflow",
          order: 7,
        },
        {
          type: "bar",
          label: "TFSA (Tax-Free)",
          data: cashFlows.tfsa_withdrawals,
          backgroundColor: "#f472b6",
          stack: "inflow",
          order: 8,
        },
      ],
    };
  }, [cashFlows]);

  // Monte Carlo Chart Data
  const monteCarloChartData = useMemo(() => {
    if (!monteCarlo || !monteCarlo.years) return null;

    return {
      labels: monteCarlo.years.map((y) => String(y)),
      datasets: [
        {
          label: "90th Percentile (Favorable)",
          data: monteCarlo.percentiles["90th"],
          borderColor: "rgba(52, 211, 153, 0.8)",
          backgroundColor: "rgba(52, 211, 153, 0.1)",
          fill: "+1",
          tension: 0.3,
          borderWidth: 1.5,
        },
        {
          label: "50th Percentile (Median)",
          data: monteCarlo.percentiles["50th"],
          borderColor: "#38bdf8",
          backgroundColor: "transparent",
          tension: 0.3,
          borderWidth: 2.5,
        },
        {
          label: "10th Percentile (Stress Market)",
          data: monteCarlo.percentiles["10th"],
          borderColor: "rgba(248, 113, 113, 0.8)",
          backgroundColor: "rgba(248, 113, 113, 0.15)",
          fill: "-1",
          tension: 0.3,
          borderWidth: 1.5,
        },
      ],
    };
  }, [monteCarlo]);

  if (loading) {
    return <div className="loading">Initializing Quebec Retirement Planning Engine...</div>;
  }

  return (
    <div>
      {/* Header */}
      <header>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <p className="eyebrow">QUEBEC STATUTORY RETIREMENT ENGINE · 2026</p>
            <h1>Retirement & Estate Optimizer</h1>
            <p>Comprehensive QPP, OAS, CRA/RQ Dual Tax, RRSP Meltdown, and Estate Simulation.</p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="secondary"
              onClick={() => runSimulation(plan)}
              disabled={simulating}
            >
              <RefreshCw size={15} className={simulating ? "spin" : ""} /> Recalculate
            </button>
            <button type="button" className="secondary" onClick={handleExportCsv}>
              <Download size={15} /> Export CSV
            </button>
            <button type="button" className="primary" onClick={handleSavePlan}>
              Save Plan
            </button>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="tab-group" style={{ marginTop: "1.25rem" }}>
          <button
            type="button"
            className={activeTab === "dashboard" ? "active" : ""}
            onClick={() => setActiveTab("dashboard")}
          >
            <Activity size={16} /> Scorecard & Inflows
          </button>
          <button
            type="button"
            className={activeTab === "monte_carlo" ? "active" : ""}
            onClick={() => setActiveTab("monte_carlo")}
          >
            <TrendingUp size={16} /> Monte Carlo & Sequence Stress
          </button>
          <button
            type="button"
            className={activeTab === "audit" ? "active" : ""}
            onClick={() => setActiveTab("audit")}
          >
            <FileSpreadsheet size={16} /> Year-by-Year Audit
          </button>
          <button
            type="button"
            className={activeTab === "inputs" ? "active" : ""}
            onClick={() => setActiveTab("inputs")}
          >
            <Sliders size={16} /> Household & Assumptions
          </button>
        </div>
      </header>

      {error && <div className="error-banner" style={{ marginBottom: "1rem" }}>{error}</div>}
      {notice && (
        <div className="success-banner" style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between" }}>
          <span>{notice}</span>
          <button type="button" className="link" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      {/* MODULE 7.1: EXECUTIVE SCORECARD HEADER */}
      {scorecard && (
        <section className="grid" style={{ marginBottom: "1.5rem" }}>
          <div className="card">
            <span className="fine">Plan Solvency Status</span>
            {scorecard.plan_success ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#34d399", marginTop: "0.25rem" }}>
                <CheckCircle2 size={24} />
                <strong style={{ fontSize: "1.3rem" }}>Funded to Age {plan.household.primary.life_expectancy_age}</strong>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#f87171", marginTop: "0.25rem" }}>
                <AlertTriangle size={24} />
                <strong style={{ fontSize: "1.3rem" }}>Shortfall at Age {scorecard.shortfall_age}</strong>
              </div>
            )}
            <p className="fine" style={{ marginTop: "0.35rem" }}>
              {scorecard.plan_success
                ? "Portfolio safely sustains target real spending."
                : "Deficit occurs before life expectancy; adjustments recommended."}
            </p>
          </div>

          <div className="card">
            <span className="fine">Avg Monthly After-Tax Income</span>
            <div style={{ fontSize: "1.6rem", fontWeight: "700", color: "#38bdf8", marginTop: "0.25rem" }}>
              {formatMoney(scorecard.average_monthly_after_tax_income)}
            </div>
            <p className="fine" style={{ marginTop: "0.35rem" }}>
              Annual: {formatMoney(scorecard.average_monthly_after_tax_income * 12)} / yr
            </p>
          </div>

          <div className="card">
            <span className="fine">Lifetime Taxes & Clawbacks</span>
            <div style={{ fontSize: "1.6rem", fontWeight: "700", color: "#fbbf24", marginTop: "0.25rem" }}>
              {formatMoney(scorecard.total_lifetime_taxes_paid)}
            </div>
            <p className="fine" style={{ marginTop: "0.35rem" }}>
              Fed: {formatMoney(scorecard.total_federal_tax_paid)} · QC: {formatMoney(scorecard.total_quebec_tax_paid)}
            </p>
          </div>

          <div className="card">
            <span className="fine">Net After-Tax Estate (Age {plan.household.primary.life_expectancy_age})</span>
            <div style={{ fontSize: "1.6rem", fontWeight: "700", color: "#a78bfa", marginTop: "0.25rem" }}>
              {formatMoney(scorecard.net_after_tax_estate)}
            </div>
            {scorecard.estate_liquidity_warning ? (
              <span className="badge negative" style={{ marginTop: "0.35rem", display: "inline-block" }}>
                Warning: Liquid Estate Shortfall
              </span>
            ) : (
              <p className="fine" style={{ marginTop: "0.35rem" }}>
                Terminal Tax Bill: {formatMoney(scorecard.terminal_tax_bill)}
              </p>
            )}
          </div>
        </section>
      )}

      {/* STRATEGY COMPARISON SANDBOX DELTA CARDS (MODULE 7.3) */}
      {comparison && (
        <section className="panel" style={{ marginBottom: "1.5rem", background: "linear-gradient(135deg, rgba(15, 29, 51, 0.8) 0%, rgba(20, 38, 68, 0.8) 100%)" }}>
          <div className="panel-header">
            <h3>Strategy Optimization Sandbox: Meltdown vs. Baseline</h3>
          </div>
          <p className="fine" style={{ marginBottom: "1rem" }}>
            Direct financial delta comparing standard ad-hoc withdrawals against systematic RRSP Meltdown targeting lower combined brackets and OAS clawback shielding:
          </p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
            <div style={{ padding: "1rem", borderRadius: "8px", background: "rgba(10, 20, 36, 0.7)", border: "1px solid var(--border-panel)" }}>
              <span className="fine">Lifetime Tax Savings</span>
              <div style={{ fontSize: "1.45rem", fontWeight: "700", color: comparison.taxes_saved >= 0 ? "#34d399" : "#f87171", marginTop: "0.25rem" }}>
                {comparison.taxes_saved >= 0 ? `+${formatMoney(comparison.taxes_saved)}` : formatMoney(comparison.taxes_saved)}
              </div>
              <p className="fine" style={{ marginTop: "0.25rem" }}>Saved across retirement lifecycle</p>
            </div>

            <div style={{ padding: "1rem", borderRadius: "8px", background: "rgba(10, 20, 36, 0.7)", border: "1px solid var(--border-panel)" }}>
              <span className="fine">Net Estate Preservation Delta</span>
              <div style={{ fontSize: "1.45rem", fontWeight: "700", color: comparison.final_estate_delta >= 0 ? "#34d399" : "#f87171", marginTop: "0.25rem" }}>
                {comparison.final_estate_delta >= 0 ? `+${formatMoney(comparison.final_estate_delta)}` : formatMoney(comparison.final_estate_delta)}
              </div>
              <p className="fine" style={{ marginTop: "0.25rem" }}>Additional wealth transferred to heirs</p>
            </div>

            <div style={{ padding: "1rem", borderRadius: "8px", background: "rgba(10, 20, 36, 0.7)", border: "1px solid var(--border-panel)" }}>
              <span className="fine">Baseline Taxes</span>
              <div style={{ fontSize: "1.2rem", fontWeight: "600", color: "#9cb2ce", marginTop: "0.25rem" }}>
                {formatMoney(comparison.baseline_lifetime_taxes)}
              </div>
              <p className="fine" style={{ marginTop: "0.25rem" }}>Without meltdown strategy</p>
            </div>

            <div style={{ padding: "1rem", borderRadius: "8px", background: "rgba(10, 20, 36, 0.7)", border: "1px solid var(--border-panel)" }}>
              <span className="fine">Optimized Taxes</span>
              <div style={{ fontSize: "1.2rem", fontWeight: "600", color: "#38bdf8", marginTop: "0.25rem" }}>
                {formatMoney(comparison.optimized_lifetime_taxes)}
              </div>
              <p className="fine" style={{ marginTop: "0.25rem" }}>With systematic meltdown</p>
            </div>
          </div>
        </section>
      )}

      {/* TAB 1: MAIN DASHBOARD & STACKED BAR CASH FLOW CHART (MODULE 7.2) */}
      {activeTab === "dashboard" && (
        <section className="stack">
          {cashFlowChartData && (
            <ChartCard
              title="Annual Retirement Cash Flow & Inflow Composition"
              subtitle="Stacked bars denote annual income sources; lines track Target Spending and Annual Taxes."
              badgeText="Age 60 → 95"
              badgeVariant="info"
              height={440}
            >
              <Bar
                data={cashFlowChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: {
                    mode: "index",
                    intersect: false,
                  },
                  plugins: {
                    legend: {
                      position: "top",
                      labels: { boxWidth: 12, padding: 12 },
                    },
                    tooltip: {
                      ...commonTooltipOptions,
                      callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.raw)}`,
                      },
                    },
                  },
                  scales: {
                    x: {
                      stacked: true,
                      grid: { color: "rgba(39, 64, 99, 0.2)" },
                    },
                    y: {
                      stacked: true,
                      grid: { color: "rgba(39, 64, 99, 0.2)" },
                      ticks: {
                        callback: (v) => formatCompactMoney(v),
                      },
                    },
                  },
                }}
              />
            </ChartCard>
          )}
        </section>
      )}

      {/* TAB 2: MONTE CARLO & SEQUENCE OF RETURNS (MODULE 10) */}
      {activeTab === "monte_carlo" && monteCarlo && (
        <section className="stack">
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
            <div className="card">
              <span className="fine">Monte Carlo Success Probability</span>
              <div style={{ fontSize: "2rem", fontWeight: "800", color: monteCarlo.probability_of_success >= 85 ? "#34d399" : "#fbbf24", marginTop: "0.25rem" }}>
                {monteCarlo.probability_of_success}%
              </div>
              <p className="fine" style={{ marginTop: "0.35rem" }}>
                {monteCarlo.successful_trials} of {monteCarlo.total_trials} random trials solvent at age {plan.household.primary.life_expectancy_age}.
              </p>
            </div>

            <div className="card">
              <span className="fine">Historical 2008 Crash Replay</span>
              <div style={{ fontSize: "1.4rem", fontWeight: "700", color: monteCarlo.crash_replay_success ? "#34d399" : "#f87171", marginTop: "0.25rem" }}>
                {monteCarlo.crash_replay_success ? "Survived -22% / -8% / +12%" : "Shortfall in Crash"}
              </div>
              <p className="fine" style={{ marginTop: "0.35rem" }}>
                Ending liquid balance: {formatMoney(monteCarlo.crash_replay_ending_balance)}
              </p>
            </div>

            <div className="card">
              <span className="fine">2-Year Cash Wedge Resilience</span>
              <div style={{ fontSize: "1.4rem", fontWeight: "700", color: "#38bdf8", marginTop: "0.25rem" }}>
                {formatMoney(monteCarlo.cash_wedge_ending_balance)}
              </div>
              <p className="fine" style={{ marginTop: "0.35rem" }}>
                Shields equity sales during down market years.
              </p>
            </div>
          </div>

          {monteCarloChartData && (
            <ChartCard
              title="Monte Carlo Lifecycle Wealth Trajectories"
              subtitle="1,000 full lifecycle simulations showing 10th (poor markets), 50th (median), and 90th (strong markets) percentiles."
              badgeText="1,000 Trials"
              badgeVariant="success"
              height={400}
            >
              <Line
                data={monteCarloChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { mode: "index", intersect: false },
                  plugins: {
                    legend: { position: "top" },
                    tooltip: {
                      ...commonTooltipOptions,
                      callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.raw)}`,
                      },
                    },
                  },
                  scales: {
                    x: { grid: { color: "rgba(39, 64, 99, 0.2)" } },
                    y: {
                      grid: { color: "rgba(39, 64, 99, 0.2)" },
                      ticks: { callback: (v) => formatCompactMoney(v) },
                    },
                  },
                }}
              />
            </ChartCard>
          )}
        </section>
      )}

      {/* TAB 3: YEAR-BY-YEAR AUDIT SPREADSHEET (MODULE 7.4) */}
      {activeTab === "audit" && (
        <section className="panel">
          <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3>Year-by-Year Statutory Audit Spreadsheet</h3>
              <p className="fine">Detailed annual breakdown of income, registered withdrawals, CRA & Revenu Québec tax lines, and balances.</p>
            </div>
            <button type="button" className="secondary" onClick={handleExportCsv}>
              <Download size={15} /> Export CSV
            </button>
          </div>

          <div style={{ overflowX: "auto", maxHeight: "580px", marginTop: "1rem" }}>
            <table className="data-table" style={{ fontSize: "0.83rem", minWidth: "1200px" }}>
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Age</th>
                  <th>Employment</th>
                  <th>QPP Pension</th>
                  <th>OAS & GIS</th>
                  <th>DB Pension</th>
                  <th>RRSP/RRIF W/D</th>
                  <th>Non-Reg W/D</th>
                  <th>TFSA W/D</th>
                  <th>Federal Tax</th>
                  <th>Quebec Tax</th>
                  <th>OAS Clawback</th>
                  <th>Home Support</th>
                  <th>Target Spend</th>
                  <th>Net Cash</th>
                  <th>RRSP End</th>
                  <th>TFSA End</th>
                  <th>Non-Reg MV</th>
                  <th>Total Net Worth</th>
                </tr>
              </thead>
              <tbody>
                {auditTable.map((r) => (
                  <tr key={r.year}>
                    <td><strong>{r.year}</strong></td>
                    <td>{r.age_primary} {r.age_spouse ? `(${r.age_spouse})` : ""}</td>
                    <td>{formatMoney(r.employment_income)}</td>
                    <td>{formatMoney(r.qpp)}</td>
                    <td>{formatMoney(r.oas_gis)}</td>
                    <td>{formatMoney(r.db_pension)}</td>
                    <td style={{ color: "#a78bfa" }}>{formatMoney(r.registered_withdrawals)}</td>
                    <td style={{ color: "#fbbf24" }}>{formatMoney(r.non_reg_withdrawals)}</td>
                    <td style={{ color: "#f472b6" }}>{formatMoney(r.tfsa_withdrawals)}</td>
                    <td>{formatMoney(r.federal_tax)}</td>
                    <td>{formatMoney(r.quebec_tax)}</td>
                    <td style={{ color: r.oas_clawback > 0 ? "#f87171" : "inherit" }}>
                      {formatMoney(r.oas_clawback)}
                    </td>
                    <td style={{ color: r.home_support_credit > 0 ? "#34d399" : "inherit" }}>
                      {formatMoney(r.home_support_credit)}
                    </td>
                    <td>{formatMoney(r.target_spending)}</td>
                    <td style={{ fontWeight: "600", color: "#38bdf8" }}>{formatMoney(r.actual_after_tax_cash)}</td>
                    <td>{formatMoney(r.rrsp_balance)}</td>
                    <td>{formatMoney(r.tfsa_balance)}</td>
                    <td>{formatMoney(r.non_reg_mv)}</td>
                    <td style={{ fontWeight: "700" }}>{formatMoney(r.total_net_worth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 4: INPUTS & PARAMETERS FORM */}
      {activeTab === "inputs" && (
        <section className="stack">
          {/* Household Profile */}
          <div className="panel">
            <div className="panel-header">
              <h3>Household & Demographics (Module 1)</h3>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <label>
                Marital Status
                <select
                  value={plan.household.marital_status}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      household: { ...plan.household, marital_status: e.target.value },
                    })
                  }
                >
                  <option value="SINGLE">Single</option>
                  <option value="COUPLE">Couple (Spouse Rollover & Splitting)</option>
                </select>
              </label>

              <label>
                Primary Current Age
                <input
                  type="number"
                  value={plan.household.primary.current_age}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      household: {
                        ...plan.household,
                        primary: { ...plan.household.primary, current_age: Number(e.target.value) },
                      },
                    })
                  }
                />
              </label>

              <label>
                Primary Retirement Age
                <input
                  type="number"
                  value={plan.household.primary.retirement_age}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      household: {
                        ...plan.household,
                        primary: { ...plan.household.primary, retirement_age: Number(e.target.value) },
                      },
                    })
                  }
                />
              </label>

              <label>
                Life Expectancy (Max 100)
                <input
                  type="number"
                  value={plan.household.primary.life_expectancy_age}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      household: {
                        ...plan.household,
                        primary: { ...plan.household.primary, life_expectancy_age: Number(e.target.value) },
                      },
                    })
                  }
                />
              </label>

              <label>
                Private Drug Insurance?
                <select
                  value={plan.household.has_private_drug_insurance ? "true" : "false"}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      household: { ...plan.household, has_private_drug_insurance: e.target.value === "true" },
                    })
                  }
                >
                  <option value="true">Yes (Exempt from RAMQ premium)</option>
                  <option value="false">No (Pay RAMQ premium on TP-1)</option>
                </select>
              </label>

              <label>
                Notarized Quebec Will?
                <select
                  value={plan.household.has_notarized_will ? "true" : "false"}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      household: { ...plan.household, has_notarized_will: e.target.value === "true" },
                    })
                  }
                >
                  <option value="true">Yes (Testament notarié, probate $0)</option>
                  <option value="false">No (Witness/Holograph will + court fee)</option>
                </select>
              </label>
            </div>
          </div>

          {/* Account Balances */}
          <div className="panel">
            <div className="panel-header">
              <h3>Account Balances & Real Estate (Module 2)</h3>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <label>
                RRSP / RRIF Balance
                <input
                  type="number"
                  value={plan.accounts.rrsp}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      accounts: { ...plan.accounts, rrsp: Number(e.target.value) },
                    })
                  }
                />
              </label>

              <label>
                TFSA Balance
                <input
                  type="number"
                  value={plan.accounts.tfsa}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      accounts: { ...plan.accounts, tfsa: Number(e.target.value) },
                    })
                  }
                />
              </label>

              <label>
                Non-Registered Market Value
                <input
                  type="number"
                  value={plan.accounts.non_reg_market_value}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      accounts: { ...plan.accounts, non_reg_market_value: Number(e.target.value) },
                    })
                  }
                />
              </label>

              <label>
                Non-Registered ACB
                <input
                  type="number"
                  value={plan.accounts.non_reg_acb}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      accounts: { ...plan.accounts, non_reg_acb: Number(e.target.value) },
                    })
                  }
                />
              </label>

              <label>
                Primary Residence Value
                <input
                  type="number"
                  value={plan.accounts.primary_residence_value}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      accounts: { ...plan.accounts, primary_residence_value: Number(e.target.value) },
                    })
                  }
                />
              </label>

              <label>
                Mortgage Balance
                <input
                  type="number"
                  value={plan.accounts.mortgage_balance}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      accounts: { ...plan.accounts, mortgage_balance: Number(e.target.value) },
                    })
                  }
                />
              </label>
            </div>
          </div>

          {/* Spending Curve & RPA */}
          <div className="panel">
            <div className="panel-header">
              <h3>Three-Phase Spending Curve & RPA (Module 5 & 9)</h3>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <label>
                Go-Go Phase Spending (Retirement → 74)
                <input
                  type="number"
                  value={plan.spending.go_go_spending}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      spending: { ...plan.spending, go_go_spending: Number(e.target.value) },
                    })
                  }
                />
              </label>

              <label>
                Slow-Go Phase Spending (75 → 84)
                <input
                  type="number"
                  value={plan.spending.slow_go_spending}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      spending: { ...plan.spending, slow_go_spending: Number(e.target.value) },
                    })
                  }
                />
              </label>

              <label>
                No-Go Phase Spending (85+)
                <input
                  type="number"
                  value={plan.spending.no_go_spending}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      spending: { ...plan.spending, no_go_spending: Number(e.target.value) },
                    })
                  }
                />
              </label>

              <label>
                RPA Transition Age (Optional)
                <input
                  type="number"
                  placeholder="e.g. 83 (leave blank if none)"
                  value={plan.spending.rpa_transition_age || ""}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      spending: {
                        ...plan.spending,
                        rpa_transition_age: e.target.value ? Number(e.target.value) : null,
                      },
                    })
                  }
                />
              </label>

              <label>
                Monthly RPA Rent (2026 $)
                <input
                  type="number"
                  value={plan.spending.monthly_rpa_rent}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      spending: { ...plan.spending, monthly_rpa_rent: Number(e.target.value) },
                    })
                  }
                />
              </label>
            </div>
          </div>

          {/* Pensions & Strategy */}
          <div className="panel">
            <div className="panel-header">
              <h3>Pensions & Strategy Overlays (Module 3, 4, 5)</h3>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              <label>
                QPP Start Age (60 to 72)
                <input
                  type="number"
                  min="60"
                  max="72"
                  value={plan.household.primary.qpp_start_age}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      household: {
                        ...plan.household,
                        primary: { ...plan.household.primary, qpp_start_age: Number(e.target.value) },
                      },
                    })
                  }
                />
              </label>

              <label>
                OAS Start Age (65 to 70)
                <input
                  type="number"
                  min="65"
                  max="70"
                  value={plan.household.primary.oas_start_age}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      household: {
                        ...plan.household,
                        primary: { ...plan.household.primary, oas_start_age: Number(e.target.value) },
                      },
                    })
                  }
                />
              </label>

              <label>
                Strategy Mode
                <select
                  value={plan.strategy.mode}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      strategy: { ...plan.strategy, mode: e.target.value },
                    })
                  }
                >
                  <option value="RRSP_MELTDOWN">RRSP Meltdown (Systematic Top-Up)</option>
                  <option value="STANDARD">Standard (Ad-Hoc Deficit Pull)</option>
                </select>
              </label>

              <label>
                Meltdown Target Ceiling
                <select
                  value={plan.strategy.target_taxable_ceiling_type}
                  onChange={(e) =>
                    setPlan({
                      ...plan,
                      strategy: { ...plan.strategy, target_taxable_ceiling_type: e.target.value },
                    })
                  }
                >
                  <option value="BRACKET_2">Bottom of 2nd Bracket ($54,345)</option>
                  <option value="OAS_CLAWBACK">OAS Clawback Threshold ($95,323)</option>
                </select>
              </label>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
