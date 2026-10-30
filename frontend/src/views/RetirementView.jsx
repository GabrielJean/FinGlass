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
  Sparkles,
  ArrowRight,
  Clock,
  Wallet,
  Shield,
  HelpCircle,
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

  const [viewMode, setViewMode] = useState("simple"); // "simple" | "advanced"

  // Senior Mode Computed Helpers
  const baseQpp65 = plan.household.primary.qpp_monthly_at_65 || 1507.65;
  const qppAt60 = Math.round(baseQpp65 * 0.64);
  const qppAt65 = Math.round(baseQpp65);
  const qppAt70 = Math.round(baseQpp65 * 1.42);

  const currentQppMult =
    plan.household.primary.qpp_start_age < 65
      ? 1.0 - (65 - plan.household.primary.qpp_start_age) * 12 * 0.006
      : plan.household.primary.qpp_start_age > 65
      ? 1.0 + (plan.household.primary.qpp_start_age - 65) * 12 * 0.007
      : 1.0;
  const primaryEstimatedQpp = Math.round(baseQpp65 * currentQppMult);

  const isCouple = plan.household.marital_status === "COUPLE";
  const estimatedOas = isCouple ? 1484 : 742;

  const primaryDbMonthly = Math.round((plan.household.primary.db_pension_annual || 0) / 12);
  const spouseDbMonthly = isCouple
    ? Math.round((plan.household.spouse?.db_pension_annual || 0) / 12)
    : 0;
  const totalDbMonthly = primaryDbMonthly + spouseDbMonthly;

  const totalLiquidSavings =
    (plan.accounts.rrsp || 0) +
    (plan.accounts.tfsa || 0) +
    (plan.accounts.non_reg_market_value || 0) +
    (isCouple
      ? (plan.accounts.spouse_rrsp || 0) + (plan.accounts.spouse_tfsa || 0)
      : 0);

  const currentMonthlySpending = Math.round((plan.spending?.go_go_spending || 60000) / 12);

  const updateAndSimulate = (updater) => {
    setPlan((prev) => {
      const nextPlan = typeof updater === "function" ? updater(prev) : updater;
      runSimulation(nextPlan);
      return nextPlan;
    });
  };

  const handleSelectQppAge = (age) => {
    updateAndSimulate((prev) => ({
      ...prev,
      household: {
        ...prev.household,
        primary: {
          ...prev.household.primary,
          qpp_start_age: age,
        },
      },
    }));
  };

  const handleAdjustSpending = (monthlyAmount) => {
    const annual = Math.max(12000, monthlyAmount * 12);
    updateAndSimulate((prev) => ({
      ...prev,
      spending: {
        ...prev.spending,
        go_go_spending: annual,
        slow_go_spending: Math.round(annual * 0.85),
        no_go_spending: Math.round(annual * 0.75),
      },
    }));
  };

  const handleStepSpending = (deltaMonthly) => {
    handleAdjustSpending(currentMonthlySpending + deltaMonthly);
  };

  const handleQuickFixShortfall = () => {
    updateAndSimulate((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next.household.primary.qpp_start_age < 65) {
        next.household.primary.qpp_start_age = 65;
      } else {
        const curMonthly = Math.round(next.spending.go_go_spending / 12);
        const newMonthly = Math.max(2500, curMonthly - 400);
        const annual = newMonthly * 12;
        next.spending.go_go_spending = annual;
        next.spending.slow_go_spending = Math.round(annual * 0.85);
        next.spending.no_go_spending = Math.round(annual * 0.75);
      }
      return next;
    });
  };

  const handleSetRrsp = (val) => {
    updateAndSimulate((prev) => ({
      ...prev,
      accounts: { ...prev.accounts, rrsp: Math.max(0, val) },
    }));
  };

  const handleSetTfsa = (val) => {
    updateAndSimulate((prev) => ({
      ...prev,
      accounts: { ...prev.accounts, tfsa: Math.max(0, val) },
    }));
  };

  const handleSetHomeValue = (val) => {
    updateAndSimulate((prev) => ({
      ...prev,
      accounts: { ...prev.accounts, primary_residence_value: Math.max(0, val) },
    }));
  };

  const handleToggleMarital = (status) => {
    updateAndSimulate((prev) => ({
      ...prev,
      household: { ...prev.household, marital_status: status },
    }));
  };

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
      {/* Top Bar */}
      <div className="top-bar">
        <div>
          <p className="eyebrow">
            {viewMode === "simple"
              ? "QUEBEC RETIREMENT PLANNER · MADE SIMPLE"
              : "QUEBEC STATUTORY RETIREMENT ENGINE · 2026"}
          </p>
          <h1>{viewMode === "simple" ? "My Retirement Plan" : "Retirement & Estate Optimizer"}</h1>
          <p>
            {viewMode === "simple"
              ? "Clear answers on your pensions, savings, and monthly spendable income."
              : "Comprehensive QPP, OAS, CRA/RQ Dual Tax, RRSP Meltdown, and Estate Simulation."}
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="secondary"
            onClick={() => runSimulation(plan)}
            disabled={simulating}
          >
            <RefreshCw size={14} className={simulating ? "spin" : ""} />
            {simulating ? "Calculating..." : "Recalculate"}
          </button>
          <button type="button" className="secondary" onClick={handleExportCsv}>
            <Download size={14} /> Export CSV
          </button>
          <button type="button" onClick={handleSavePlan}>
            Save Plan
          </button>
        </div>
      </div>

      {/* View Mode Switcher */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginTop: "1rem", marginBottom: "1rem" }}>
        <div className="view-mode-selector">
          <button
            type="button"
            className={`view-mode-btn ${viewMode === "simple" ? "active" : ""}`}
            onClick={() => setViewMode("simple")}
          >
            <Sparkles size={16} /> Simple Summary (Recommended)
          </button>
          <button
            type="button"
            className={`view-mode-btn ${viewMode === "advanced" ? "active" : ""}`}
            onClick={() => setViewMode("advanced")}
          >
            <Activity size={16} /> Advanced Financial View
          </button>
        </div>

        {viewMode === "simple" && (
          <span style={{ fontSize: "0.88rem", color: "#94a3b8" }}>
            ✨ Designed for retirees & seniors · Fast, clear, and easy
          </span>
        )}
      </div>

      {error && <div className="error-banner" style={{ marginBottom: "1rem" }}>{error}</div>}
      {notice && (
        <div className="success-banner" style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between" }}>
          <span>{notice}</span>
          <button type="button" className="link" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. SIMPLE VIEW FOR SENIORS (BRAIN-DEAD EASY MODE)                         */}
      {/* ========================================================================= */}
      {viewMode === "simple" && (
        <div className="senior-container">
          {/* 1. Solvency Hero Banner */}
          <div className={`senior-hero ${scorecard?.plan_success ? "success" : "warning"}`}>
            <div className="senior-hero-content">
              <div className="senior-hero-icon">
                {scorecard?.plan_success ? <CheckCircle2 size={38} /> : <AlertTriangle size={38} />}
              </div>
              <div>
                <h2 className="senior-hero-title">
                  {scorecard?.plan_success
                    ? "You're In Great Shape! Your Money Will Last Past Age 95"
                    : `Heads Up: Your Savings Might Run Low Around Age ${scorecard?.shortfall_age}`}
                </h2>
                <p className="senior-hero-desc">
                  {scorecard?.plan_success
                    ? "Your pensions, government benefits, and personal savings comfortably cover all your monthly bills for life. You don't have to worry about running out of money."
                    : "Don't panic! Usually a small tweak to your monthly spending or waiting an extra year or two to take your Quebec pension completely fixes this."}
                </p>
              </div>
            </div>

            <div className="senior-hero-pills">
              {scorecard?.plan_success ? (
                <>
                  <div className="senior-hero-pill">
                    <span className="senior-hero-pill-label">Leaving to Family (Net Estate)</span>
                    <span className="senior-hero-pill-value" style={{ color: "#a78bfa" }}>
                      {formatMoney(scorecard.net_after_tax_estate)}
                    </span>
                  </div>
                  {comparison?.taxes_saved > 0 && (
                    <div className="senior-hero-pill">
                      <span className="senior-hero-pill-label">Smart Tax Savings</span>
                      <span className="senior-hero-pill-value" style={{ color: "#34d399" }}>
                        +{formatMoney(comparison.taxes_saved)}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleQuickFixShortfall}
                  style={{ fontSize: "1rem", padding: "0.85rem 1.4rem" }}
                >
                  <ShieldCheck size={18} /> Fix This For Me in 1 Click
                </button>
              )}
            </div>
          </div>

          {/* 2. Monthly Spendable Paycheck Card */}
          <div className="senior-card">
            <div className="senior-paycheck-container">
              <div>
                <div className="senior-card-header">
                  <h3>Your Monthly Spendable Paycheck</h3>
                  <p>Clear cash in your pocket every month, after all Quebec & Federal taxes are paid.</p>
                </div>
                <div className="senior-paycheck-figure">
                  {formatMoney(scorecard?.average_monthly_after_tax_income || 0)}
                  <span style={{ fontSize: "1.2rem", fontWeight: "600", color: "#94a3b8", marginLeft: "0.5rem" }}>
                    / month
                  </span>
                </div>
                <p className="senior-paycheck-sub">
                  Annual take-home income: <strong>{formatMoney((scorecard?.average_monthly_after_tax_income || 0) * 12)} / year</strong>
                </p>
                <p style={{ color: "#64748b", fontSize: "0.88rem", marginTop: "0.5rem" }}>
                  💡 All provincial (Revenu Québec) and federal (CRA) taxes and deductions are already paid. This is yours to spend on groceries, hobbies, dining, gas, and family.
                </p>
              </div>

              <div className="senior-stepper-box">
                <label style={{ fontWeight: "700", color: "#f1f5f9", fontSize: "0.98rem", display: "block", marginBottom: "0.5rem" }}>
                  Change Target Monthly Spending:
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => handleStepSpending(-250)}
                    style={{ flex: 1, padding: "0.7rem 0.5rem", fontSize: "0.95rem" }}
                  >
                    ➖ $250 Less
                  </button>
                  <div style={{ textAlign: "center", minWidth: "110px" }}>
                    <span style={{ fontSize: "1.3rem", fontWeight: "800", color: "#38bdf8", fontFamily: "var(--font-mono)" }}>
                      {formatMoney(currentMonthlySpending)}
                    </span>
                    <span style={{ display: "block", fontSize: "0.75rem", color: "#64748b" }}>target / mo</span>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => handleStepSpending(250)}
                    style={{ flex: 1, padding: "0.7rem 0.5rem", fontSize: "0.95rem" }}
                  >
                    ➕ $250 More
                  </button>
                </div>

                <div style={{ fontSize: "0.82rem", color: "#94a3b8", marginBottom: "0.35rem" }}>Quick amounts:</div>
                <div className="senior-preset-row">
                  {[3500, 4500, 5000, 6000, 7500].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      className={`senior-preset-btn ${currentMonthlySpending === amt ? "active" : ""}`}
                      onClick={() => handleAdjustSpending(amt)}
                    >
                      ${(amt / 1000).toFixed(amt % 1000 === 0 ? 0 : 1)}k/mo
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 3. Where Does Your Money Come From? */}
          <div className="senior-card">
            <div className="senior-card-header">
              <h3>Where Does Your Monthly Money Come From?</h3>
              <p>A simple breakdown of your guaranteed government pensions and personal nest egg:</p>
            </div>

            <div className="senior-income-grid">
              {/* QPP */}
              <div className="senior-income-item">
                <div>
                  <div className="senior-income-icon">🇨🇦</div>
                  <h4 className="senior-income-name">Quebec Pension (RRQ / QPP)</h4>
                  <div className="senior-income-val">{formatMoney(primaryEstimatedQpp)} <span style={{ fontSize: "0.9rem", color: "#64748b" }}>/mo</span></div>
                </div>
                <p className="senior-income-desc">
                  Guaranteed for life by the Quebec government. Increases with inflation every January.
                  {plan.household.primary.qpp_start_age !== 65 && ` (Started at age ${plan.household.primary.qpp_start_age})`}
                </p>
              </div>

              {/* OAS */}
              <div className="senior-income-item">
                <div>
                  <div className="senior-income-icon">🍁</div>
                  <h4 className="senior-income-name">Old Age Security (OAS)</h4>
                  <div className="senior-income-val">~{formatMoney(estimatedOas)} <span style={{ fontSize: "0.9rem", color: "#64748b" }}>/mo</span></div>
                </div>
                <p className="senior-income-desc">
                  Monthly federal pension paid to all Canadian residents who have lived in Canada for 40+ years, starting at age 65.
                </p>
              </div>

              {/* DB Pension */}
              <div className="senior-income-item">
                <div>
                  <div className="senior-income-icon">💼</div>
                  <h4 className="senior-income-name">Workplace Pension</h4>
                  <div className="senior-income-val" style={{ color: totalDbMonthly > 0 ? "#34d399" : "#64748b" }}>
                    {totalDbMonthly > 0 ? `${formatMoney(totalDbMonthly)} /mo` : "$0 /mo"}
                  </div>
                </div>
                <p className="senior-income-desc">
                  {totalDbMonthly > 0
                    ? "Guaranteed monthly company defined benefit pension."
                    : "No company pension entered (your lifestyle is funded by your personal savings)."}
                </p>
              </div>

              {/* Personal Savings */}
              <div className="senior-income-item">
                <div>
                  <div className="senior-income-icon">🏦</div>
                  <h4 className="senior-income-name">Your Personal Savings</h4>
                  <div className="senior-income-val" style={{ color: "#38bdf8" }}>
                    {formatMoney(totalLiquidSavings)}
                  </div>
                </div>
                <p className="senior-income-desc">
                  Total liquid nest egg in RRSP & TFSA. Automatically drawn down in the most tax-friendly sequence to cover your spending.
                </p>
              </div>
            </div>
          </div>

          {/* 4. 3 Simple Levers You Can Change */}
          <div className="senior-card">
            <div className="senior-card-header">
              <h3>3 Simple Decisions You Control</h3>
              <p>Click any option below to see how it instantly changes your monthly money and peace of mind:</p>
            </div>

            {/* Decision 1: QPP Start Age */}
            <div style={{ marginBottom: "2rem" }}>
              <h4 style={{ fontSize: "1.1rem", color: "#f1f5f9", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Clock size={18} color="#38bdf8" /> 1. When do you want to start taking your Quebec Pension (QPP)?
              </h4>
              <p style={{ color: "#94a3b8", fontSize: "0.92rem", marginBottom: "1rem" }}>
                You can start QPP anytime between 60 and 70. Starting early gets you cash sooner, but waiting gives you a permanently bigger check every month for the rest of your life.
              </p>

              <div className="senior-choice-grid">
                {/* Age 60 */}
                <div
                  className={`senior-choice-card ${plan.household.primary.qpp_start_age === 60 ? "selected" : ""}`}
                  onClick={() => handleSelectQppAge(60)}
                >
                  <span className="senior-choice-badge early">Take it Early (Age 60)</span>
                  <div className="senior-choice-title">Age 60</div>
                  <div className="senior-choice-amount">{formatMoney(qppAt60)} / mo</div>
                  <p className="senior-choice-note">
                    You get checks 5 years earlier, but they are permanently <strong>36% smaller</strong> for life. Good if you want to stop working immediately.
                  </p>
                </div>

                {/* Age 65 */}
                <div
                  className={`senior-choice-card ${plan.household.primary.qpp_start_age === 65 ? "selected" : ""}`}
                  onClick={() => handleSelectQppAge(65)}
                >
                  <span className="senior-choice-badge default">Standard Age (Age 65)</span>
                  <div className="senior-choice-title">Age 65</div>
                  <div className="senior-choice-amount">{formatMoney(qppAt65)} / mo</div>
                  <p className="senior-choice-note">
                    The normal retirement age in Quebec. You receive <strong>100%</strong> of your benchmark pension.
                  </p>
                </div>

                {/* Age 70 */}
                <div
                  className={`senior-choice-card ${plan.household.primary.qpp_start_age === 70 ? "selected" : ""}`}
                  onClick={() => handleSelectQppAge(70)}
                >
                  <span className="senior-choice-badge bonus">+42% Bonus Cash (Age 70)</span>
                  <div className="senior-choice-title">Age 70</div>
                  <div className="senior-choice-amount">{formatMoney(qppAt70)} / mo</div>
                  <p className="senior-choice-note">
                    Wait until 70 and the Quebec government permanently gives you <strong>+42% more cash</strong> every single month for life.
                  </p>
                </div>
              </div>
            </div>

            {/* Decision 2: Current Nest Egg */}
            <div style={{ marginBottom: "2rem" }}>
              <h4 style={{ fontSize: "1.1rem", color: "#f1f5f9", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Wallet size={18} color="#38bdf8" /> 2. What do you have saved in your nest egg?
              </h4>
              <p style={{ color: "#94a3b8", fontSize: "0.92rem", marginBottom: "1rem" }}>
                Click a quick button or type your current balance:
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1.25rem" }}>
                {/* RRSP */}
                <div className="senior-stepper-box">
                  <label style={{ fontWeight: "700", color: "#f1f5f9", display: "block", marginBottom: "0.4rem" }}>
                    RRSP / RRIF Savings:
                  </label>
                  <input
                    type="number"
                    step="5000"
                    value={plan.accounts.rrsp}
                    onChange={(e) => handleSetRrsp(parseFloat(e.target.value) || 0)}
                    style={{ fontSize: "1.1rem", fontWeight: "700", marginBottom: "0.6rem" }}
                  />
                  <div className="senior-preset-row">
                    {[150000, 250000, 350000, 500000].map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={`senior-preset-btn ${plan.accounts.rrsp === v ? "active" : ""}`}
                        onClick={() => handleSetRrsp(v)}
                      >
                        ${v / 1000}k
                      </button>
                    ))}
                  </div>
                </div>

                {/* TFSA */}
                <div className="senior-stepper-box">
                  <label style={{ fontWeight: "700", color: "#f1f5f9", display: "block", marginBottom: "0.4rem" }}>
                    TFSA (Tax-Free Savings):
                  </label>
                  <input
                    type="number"
                    step="5000"
                    value={plan.accounts.tfsa}
                    onChange={(e) => handleSetTfsa(parseFloat(e.target.value) || 0)}
                    style={{ fontSize: "1.1rem", fontWeight: "700", marginBottom: "0.6rem" }}
                  />
                  <div className="senior-preset-row">
                    {[30000, 60000, 95000, 150000].map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={`senior-preset-btn ${plan.accounts.tfsa === v ? "active" : ""}`}
                        onClick={() => handleSetTfsa(v)}
                      >
                        ${v / 1000}k
                      </button>
                    ))}
                  </div>
                </div>

                {/* Home */}
                <div className="senior-stepper-box">
                  <label style={{ fontWeight: "700", color: "#f1f5f9", display: "block", marginBottom: "0.4rem" }}>
                    Family Home Value:
                  </label>
                  <input
                    type="number"
                    step="25000"
                    value={plan.accounts.primary_residence_value}
                    onChange={(e) => handleSetHomeValue(parseFloat(e.target.value) || 0)}
                    style={{ fontSize: "1.1rem", fontWeight: "700", marginBottom: "0.6rem" }}
                  />
                  <div className="senior-preset-row">
                    {[0, 450000, 650000, 850000].map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={`senior-preset-btn ${plan.accounts.primary_residence_value === v ? "active" : ""}`}
                        onClick={() => handleSetHomeValue(v)}
                      >
                        {v === 0 ? "No Home" : `$${v / 1000}k`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Decision 3: Single or Couple */}
            <div>
              <h4 style={{ fontSize: "1.1rem", color: "#f1f5f9", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Users size={18} color="#38bdf8" /> 3. Are you doing this solo or with your partner?
              </h4>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className={!isCouple ? "primary" : "secondary"}
                  onClick={() => handleToggleMarital("SINGLE")}
                  style={{ padding: "0.85rem 1.6rem", fontSize: "1rem" }}
                >
                  <User size={18} /> Just Myself (Single)
                </button>
                <button
                  type="button"
                  className={isCouple ? "primary" : "secondary"}
                  onClick={() => handleToggleMarital("COUPLE")}
                  style={{ padding: "0.85rem 1.6rem", fontSize: "1rem" }}
                >
                  <Users size={18} /> My Partner & Me (Couple)
                </button>
              </div>

              {isCouple && (
                <div style={{ marginTop: "1rem", padding: "1rem 1.25rem", background: "rgba(56, 189, 248, 0.08)", border: "1px solid rgba(56, 189, 248, 0.25)", borderRadius: "var(--radius-md)" }}>
                  <p style={{ margin: 0, fontSize: "0.92rem", color: "#e2e8f0" }}>
                    ✨ <strong>Pension Income Splitting Active:</strong> We automatically split eligible pension income between you and your spouse to keep you both in lower tax brackets and protect your OAS checks from clawbacks.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 5. Key Financial Tips */}
          <div className="senior-card">
            <div className="senior-card-header">
              <h3>Key Tips from Your Financial Co-Pilot</h3>
              <p>Three essential rules every Quebec retiree should know:</p>
            </div>

            <div className="senior-tips-grid">
              <div className="senior-tip-item">
                <div className="senior-tip-icon">🛡️</div>
                <div>
                  <h4 className="senior-tip-title">The RRSP Tax Trick</h4>
                  <p className="senior-tip-text">
                    If you leave your RRSP untouched until age 72, the government forces huge lump-sum withdrawals that jump you into high tax brackets and cancel your OAS checks. We use a smooth withdrawal strategy that <strong>saves you an estimated {formatMoney(comparison?.taxes_saved || 15956)} in cold hard cash!</strong>
                  </p>
                </div>
              </div>

              <div className="senior-tip-item">
                <div className="senior-tip-icon">🏡</div>
                <div>
                  <h4 className="senior-tip-title">Your Home Is 100% Tax-Free</h4>
                  <p className="senior-tip-text">
                    In Quebec and Canada, your family home is completely exempt from capital gains tax. If you sell or pass it down to your kids, the government takes $0 of the profit.
                  </p>
                </div>
              </div>

              <div className="senior-tip-item">
                <div className="senior-tip-icon">📜</div>
                <div>
                  <h4 className="senior-tip-title">Get a Quebec Notarized Will</h4>
                  <p className="senior-tip-text">
                    In Quebec, a will drafted by a notary avoids months of court probate delays and legal fees for your heirs. If you don't have one yet, an afternoon with a notary will save your family immense stress.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 6. Footer Actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginTop: "0.5rem", marginBottom: "2rem" }}>
            <button
              type="button"
              onClick={handleSavePlan}
              style={{ padding: "0.9rem 1.75rem", fontSize: "1.05rem", fontWeight: "800" }}
            >
              <CheckCircle2 size={18} /> Save My Numbers
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => setViewMode("advanced")}
              style={{ padding: "0.85rem 1.35rem", fontSize: "0.95rem" }}
            >
              See Full Financial Analyst Report & Spreadsheets <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. ADVANCED FINANCIAL ANALYST VIEW                                       */}
      {/* ========================================================================= */}
      {viewMode === "advanced" && (
        <>
          {/* Tabs */}
          <div className="tabs" style={{ marginTop: "1.25rem", marginBottom: "1.5rem" }}>
            <button
              type="button"
              className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              <Activity size={15} style={{ marginRight: 6, display: "inline-block", verticalAlign: "middle" }} />
              Scorecard & Inflows
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === "monte_carlo" ? "active" : ""}`}
              onClick={() => setActiveTab("monte_carlo")}
            >
              <TrendingUp size={15} style={{ marginRight: 6, display: "inline-block", verticalAlign: "middle" }} />
              Monte Carlo & Sequence Stress
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === "audit" ? "active" : ""}`}
              onClick={() => setActiveTab("audit")}
            >
              <FileSpreadsheet size={15} style={{ marginRight: 6, display: "inline-block", verticalAlign: "middle" }} />
              Year-by-Year Audit
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === "inputs" ? "active" : ""}`}
              onClick={() => setActiveTab("inputs")}
            >
              <Sliders size={15} style={{ marginRight: 6, display: "inline-block", verticalAlign: "middle" }} />
              Household & Assumptions
            </button>
          </div>

      {/* MODULE 7.1: EXECUTIVE SCORECARD HEADER */}
      {scorecard && (
        <section className="kpi-grid">
          <div className="kpi-card">
            <span className="kpi-label">Plan Solvency Status</span>
            {scorecard.plan_success ? (
              <span className="kpi-val text-positive" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <CheckCircle2 size={20} /> Funded to {plan.household.primary.life_expectancy_age}
              </span>
            ) : (
              <span className="kpi-val text-negative" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <AlertTriangle size={20} /> Shortfall at Age {scorecard.shortfall_age}
              </span>
            )}
            <span className="kpi-sub">
              {scorecard.plan_success
                ? "Portfolio safely sustains target real spending."
                : "Deficit occurs before life expectancy; adjustments recommended."}
            </span>
          </div>

          <div className="kpi-card">
            <span className="kpi-label">Avg Monthly After-Tax Income</span>
            <span className="kpi-val">{formatMoney(scorecard.average_monthly_after_tax_income)}</span>
            <span className="kpi-sub">
              Annual: <strong className="num">{formatMoney(scorecard.average_monthly_after_tax_income * 12)}</strong>
            </span>
          </div>

          <div className="kpi-card">
            <span className="kpi-label">Lifetime Taxes & Clawbacks</span>
            <span className="kpi-val" style={{ color: "#fbbf24" }}>{formatMoney(scorecard.total_lifetime_taxes_paid)}</span>
            <span className="kpi-sub">
              Fed: {formatMoney(scorecard.total_federal_tax_paid)} · QC: {formatMoney(scorecard.total_quebec_tax_paid)}
            </span>
          </div>

          <div className="kpi-card">
            <span className="kpi-label">Net After-Tax Estate (Age {plan.household.primary.life_expectancy_age})</span>
            <span className="kpi-val" style={{ color: "#a78bfa" }}>{formatMoney(scorecard.net_after_tax_estate)}</span>
            {scorecard.estate_liquidity_warning ? (
              <span className="badge negative" style={{ alignSelf: "flex-start", marginTop: "0.2rem" }}>
                Warning: Liquid Estate Shortfall
              </span>
            ) : (
              <span className="kpi-sub">
                Terminal Tax Bill: {formatMoney(scorecard.terminal_tax_bill)}
              </span>
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
          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">Lifetime Tax Savings</span>
              <span className={`kpi-val ${comparison.taxes_saved >= 0 ? "text-positive" : "text-negative"}`}>
                {comparison.taxes_saved >= 0 ? `+${formatMoney(comparison.taxes_saved)}` : formatMoney(comparison.taxes_saved)}
              </span>
              <span className="kpi-sub">Saved across retirement lifecycle</span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Net Estate Preservation Delta</span>
              <span className={`kpi-val ${comparison.final_estate_delta >= 0 ? "text-positive" : "text-negative"}`}>
                {comparison.final_estate_delta >= 0 ? `+${formatMoney(comparison.final_estate_delta)}` : formatMoney(comparison.final_estate_delta)}
              </span>
              <span className="kpi-sub">Additional wealth transferred to heirs</span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Baseline Taxes</span>
              <span className="kpi-val" style={{ color: "#9cb2ce" }}>{formatMoney(comparison.baseline_lifetime_taxes)}</span>
              <span className="kpi-sub">Without meltdown strategy</span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Optimized Taxes</span>
              <span className="kpi-val" style={{ color: "#38bdf8" }}>{formatMoney(comparison.optimized_lifetime_taxes)}</span>
              <span className="kpi-sub">With systematic meltdown</span>
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
          <div className="kpi-grid" style={{ marginBottom: "1rem" }}>
            <div className="kpi-card">
              <span className="kpi-label">Monte Carlo Success Probability</span>
              <span
                className="kpi-val"
                style={{
                  fontSize: "2rem",
                  color: monteCarlo.probability_of_success >= 85 ? "#34d399" : "#fbbf24",
                }}
              >
                {monteCarlo.probability_of_success}%
              </span>
              <span className="kpi-sub">
                {monteCarlo.successful_trials} of {monteCarlo.total_trials} random trials solvent at age {plan.household.primary.life_expectancy_age}.
              </span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Historical 2008 Crash Replay</span>
              <span
                className="kpi-val"
                style={{
                  fontSize: "1.3rem",
                  color: monteCarlo.crash_replay_success ? "#34d399" : "#f87171",
                }}
              >
                {monteCarlo.crash_replay_success ? "Survived -22% / -8% / +12%" : "Shortfall in Crash"}
              </span>
              <span className="kpi-sub">
                Ending liquid balance: <strong className="num">{formatMoney(monteCarlo.crash_replay_ending_balance)}</strong>
              </span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">2-Year Cash Wedge Resilience</span>
              <span className="kpi-val" style={{ color: "#38bdf8", fontSize: "1.3rem" }}>
                {formatMoney(monteCarlo.cash_wedge_ending_balance)}
              </span>
              <span className="kpi-sub">
                Shields equity sales during down market years.
              </span>
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

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
              <button
                type="button"
                className="secondary"
                onClick={() => runSimulation(plan)}
                disabled={simulating}
              >
                <RefreshCw size={14} className={simulating ? "spin" : ""} />
                {simulating ? "Calculating..." : "Recalculate Plan"}
              </button>
              <button type="button" onClick={handleSavePlan}>
                Save Plan Changes
              </button>
            </div>
          </div>
        </section>
      )}
        </>
      )}
    </div>
  );
}

