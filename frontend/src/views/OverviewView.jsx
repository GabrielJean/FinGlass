import React, { useEffect, useState } from "react";
import { api } from "../api";
import { formatMoney, formatPercent, formatDate } from "../utils/formatters";
import {
  TrendingUp,
  Wallet,
  Landmark,
  CreditCard,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  RefreshCw,
  PlusCircle,
} from "lucide-react";

export function OverviewView({ onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [tfsaSummary, setTfsaSummary] = useState(null);
  const [rrspSummary, setRrspSummary] = useState(null);
  const [fhsaSummary, setFhsaSummary] = useState(null);
  const [ccDashboard, setCcDashboard] = useState(null);
  const [cheqDashboard, setCheqDashboard] = useState(null);
  const [refreshingQuotes, setRefreshingQuotes] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [dash, tfsa, rrsp, fhsa, cc, cheq] = await Promise.allSettled([
        api.holdings.getDashboard(),
        api.tfsa.getSummary(),
        api.rrsp.getSummary(),
        api.fhsa.getSummary(),
        api.creditCard.getDashboard(),
        api.chequing.getDashboard(),
      ]);

      if (dash.status === "fulfilled") setDashboard(dash.value);
      if (tfsa.status === "fulfilled") setTfsaSummary(tfsa.value);
      if (rrsp.status === "fulfilled") setRrspSummary(rrsp.value);
      if (fhsa.status === "fulfilled") setFhsaSummary(fhsa.value);
      if (cc.status === "fulfilled") setCcDashboard(cc.value);
      if (cheq.status === "fulfilled") setCheqDashboard(cheq.value);
    } catch (err) {
      setError(err.message || "Failed to load portfolio overview.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRefreshQuotes = async () => {
    setRefreshingQuotes(true);
    setRefreshNotice("");
    try {
      const res = await api.holdings.refreshMarketValues();
      setRefreshNotice(`Refreshed ${res.rows_updated} positions across ${res.symbols_priced} symbols.`);
      loadData();
    } catch (err) {
      setRefreshNotice(`Quote refresh warning: ${err.message}`);
    } finally {
      setRefreshingQuotes(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading portfolio overview...</div>;
  }

  const summary = dashboard?.summary || {};
  const totalMarket = Number(summary.market_value || 0);
  const totalBook = Number(summary.book_value_cad || 0);
  const unrealizedReturn = Number(summary.unrealized_return || 0);
  const unrealizedPct = totalBook > 0 ? (unrealizedReturn / totalBook) * 100 : 0;
  const isPositive = unrealizedReturn >= 0;

  // Calculate quick net worth estimate
  const ccDebt = Number(ccDashboard?.summary?.total_expenses ?? ccDashboard?.total_spending ?? 0);
  const cheqBalance = Number(cheqDashboard?.summary?.net_flow || 0);
  const netWorthEstimate = totalMarket - ccDebt;

  // Registered account metrics
  const tfsaAvailable = Number(tfsaSummary?.total_available_room || 0);
  const tfsaRemaining = Number(tfsaSummary?.total_remaining ?? tfsaSummary?.current_year_room ?? 0);
  const tfsaUsed = Number(tfsaSummary?.room_used ?? tfsaSummary?.total_deposits ?? 0);
  const tfsaUsedPct = tfsaAvailable > 0 ? Math.min(100, Math.max(0, (tfsaUsed / tfsaAvailable) * 100)) : 0;
  const tfsaStatus = tfsaSummary?.room_status || null;
  const tfsaBarColor = tfsaStatus === "over-limit" ? "#ef4444" : tfsaStatus === "near-limit" ? "#f59e0b" : tfsaStatus === "full" ? "#10b981" : "var(--accent)";

  const rrspAvailable = Number(rrspSummary?.total_available_room || 0);
  const rrspRemaining = Number(rrspSummary?.total_remaining ?? rrspSummary?.current_year_room ?? 0);
  const rrspUsed = Number(rrspSummary?.room_used ?? rrspSummary?.total_deposits ?? 0);
  const rrspUsedPct = rrspAvailable > 0 ? Math.min(100, Math.max(0, (rrspUsed / rrspAvailable) * 100)) : 0;
  const rrspStatus = rrspSummary?.room_status || null;
  const rrspBarColor = rrspStatus === "over-limit" ? "#ef4444" : rrspStatus === "near-limit" ? "#f59e0b" : rrspStatus === "full" ? "#10b981" : "#91b6ff";

  const fhsaLifetimeLimit = Number(fhsaSummary?.lifetime_limit || 40000);
  const fhsaRemaining = Number(fhsaSummary?.total_remaining ?? fhsaSummary?.current_year_room ?? 0);
  const fhsaLifetimeRemaining = Number(fhsaSummary?.lifetime_contribution_remaining ?? fhsaSummary?.lifetime_room_remaining ?? 40000);
  const fhsaUsed = Number(fhsaSummary?.room_used ?? fhsaSummary?.total_deposits ?? 0);
  const fhsaUsedPct = fhsaLifetimeLimit > 0 ? Math.min(100, Math.max(0, (fhsaUsed / fhsaLifetimeLimit) * 100)) : 0;
  const fhsaStatusBarColor = fhsaSummary?.room_status === "over-limit" ? "#ef4444" : fhsaSummary?.room_status === "full" ? "#10b981" : "#ffd391";

  return (
    <div>
      <header>
        <p className="eyebrow">PORTFOLIO INTELLIGENCE</p>
        <h1>Portfolio Overview</h1>
        <p>Comprehensive snapshot of your assets, performance, and registered rooms.</p>
      </header>

      {error && <div className="error-banner" style={{ marginBottom: "1.5rem" }}>{error}</div>}
      {refreshNotice && (
        <div className="notice" style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "space-between" }}>
          <span>{refreshNotice}</span>
          <button type="button" className="link" onClick={() => setRefreshNotice("")}>Dismiss</button>
        </div>
      )}

      {/* Primary KPI Row */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Total Portfolio</span>
          <span className="kpi-val">{formatMoney(totalMarket)}</span>
          <span className="kpi-sub">
            Book Value: <strong className="num">{formatMoney(totalBook)}</strong>
          </span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Unrealized Return</span>
          <span className={`kpi-val ${isPositive ? "text-positive" : "text-negative"}`}>
            {formatMoney(unrealizedReturn)}
          </span>
          <span className={`kpi-sub ${isPositive ? "positive" : "negative"}`}>
            {formatPercent(unrealizedPct)} lifetime gain/loss
          </span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Active Positions</span>
          <span className="kpi-val">{summary.positions || 0}</span>
          <span className="kpi-sub">Across {summary.accounts || 0} accounts</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">As of Snapshot</span>
          <span className="kpi-val" style={{ fontSize: "1.3rem" }}>
            {dashboard?.as_of ? formatDate(dashboard.as_of) : "No data yet"}
          </span>
          <span className="kpi-sub">
            <button
              type="button"
              className="link"
              disabled={refreshingQuotes}
              onClick={handleRefreshQuotes}
              style={{ padding: 0 }}
            >
              <RefreshCw size={12} className={refreshingQuotes ? "spin" : ""} style={{ marginRight: 4 }} />
              {refreshingQuotes ? "Refreshing..." : "Refresh Quotes"}
            </button>
          </span>
        </div>
      </section>

      {/* Registered Accounts Room Glances */}
      <h2 style={{ fontSize: "1.2rem", margin: "2rem 0 1rem", fontWeight: 700 }}>
        Registered Tax Shelters (CRA Limits)
      </h2>
      <section className="kpi-grid">
        <div
          className="kpi-card"
          style={{ cursor: "pointer", transition: "transform 0.15s ease" }}
          onClick={() => onNavigate("tfsa")}
          title="Click to view TFSA details"
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="kpi-label">TFSA Room</span>
            {tfsaStatus && tfsaStatus !== "normal" ? (
              <span className={`room-badge ${tfsaStatus}`}>{tfsaStatus.replace("-", " ")}</span>
            ) : (
              <span className="status positive">Tax-Free</span>
            )}
          </div>
          <span className="kpi-val" style={{ color: "var(--accent)" }}>
            {formatMoney(tfsaRemaining)}
          </span>
          <span className="kpi-sub">
            of <strong className="num">{formatMoney(tfsaAvailable)}</strong> available CRA room
          </span>
          <div className="room-progress-wrap">
            <div className="room-progress-track">
              <div className="room-progress-fill" style={{ width: `${tfsaUsedPct}%`, background: tfsaBarColor }} />
            </div>
            <div className="room-progress-meta">
              <span>{tfsaUsedPct.toFixed(1)}% utilized</span>
              <span>{(100 - tfsaUsedPct).toFixed(1)}% left</span>
            </div>
          </div>
        </div>

        <div
          className="kpi-card"
          style={{ cursor: "pointer", transition: "transform 0.15s ease" }}
          onClick={() => onNavigate("rrsp")}
          title="Click to view RRSP details"
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="kpi-label">RRSP Room</span>
            {rrspStatus && rrspStatus !== "normal" ? (
              <span className={`room-badge ${rrspStatus}`}>{rrspStatus.replace("-", " ")}</span>
            ) : (
              <span className="status info">Tax-Deferred</span>
            )}
          </div>
          <span className="kpi-val" style={{ color: "#91b6ff" }}>
            {formatMoney(rrspRemaining)}
          </span>
          <span className="kpi-sub">
            of <strong className="num">{formatMoney(rrspAvailable)}</strong> deduction limit
          </span>
          <div className="room-progress-wrap">
            <div className="room-progress-track">
              <div className="room-progress-fill" style={{ width: `${rrspUsedPct}%`, background: rrspBarColor }} />
            </div>
            <div className="room-progress-meta">
              <span>{rrspUsedPct.toFixed(1)}% utilized</span>
              <span>{(100 - rrspUsedPct).toFixed(1)}% left</span>
            </div>
          </div>
        </div>

        <div
          className="kpi-card"
          style={{ cursor: "pointer", transition: "transform 0.15s ease" }}
          onClick={() => onNavigate("fhsa")}
          title="Click to view FHSA details"
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="kpi-label">FHSA Room</span>
            <span className="status info">First Home</span>
          </div>
          <span className="kpi-val" style={{ color: "#ffd391" }}>
            {formatMoney(fhsaRemaining)}
          </span>
          <span className="kpi-sub">
            {formatMoney(fhsaLifetimeRemaining)} lifetime room left
          </span>
          <div className="room-progress-wrap">
            <div className="room-progress-track">
              <div className="room-progress-fill" style={{ width: `${fhsaUsedPct}%`, background: fhsaStatusBarColor }} />
            </div>
            <div className="room-progress-meta">
              <span>{fhsaUsedPct.toFixed(1)}% of $40k used</span>
              <span>{(100 - fhsaUsedPct).toFixed(1)}% left</span>
            </div>
          </div>
        </div>
      </section>

      {/* Top Holdings & Accounts Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(450px, 1fr))", gap: "1.5rem", marginTop: "2rem" }}>
        {/* Top Holdings Panel */}
        <section className="panel" style={{ margin: 0 }}>
          <div className="panel-header">
            <h3>Top Holdings</h3>
            <button type="button" className="link" onClick={() => onNavigate("holdings")}>
              View All Positions &rarr;
            </button>
          </div>

          {!dashboard?.top_holdings?.length ? (
            <div className="empty" style={{ padding: "2rem" }}>
              <p>No investment positions recorded yet.</p>
              <button
                type="button"
                className="secondary"
                style={{ marginTop: "1rem" }}
                onClick={() => onNavigate("import")}
              >
                Import Activities or Holdings CSV
              </button>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Security Name</th>
                    <th className="num">Shares</th>
                    <th className="num">Market Val</th>
                    <th className="num">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.top_holdings || []).slice(0, 7).map((h) => {
                    const ret = Number(h.unrealized_return || 0);
                    return (
                      <tr key={h.symbol}>
                        <td>
                          <button
                            type="button"
                            className="link mono"
                            style={{ padding: 0, fontWeight: 700 }}
                            onClick={() => onNavigate("acb", { symbol: h.symbol })}
                          >
                            {h.symbol}
                          </button>
                        </td>
                        <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.security_name || "-"}
                        </td>
                        <td className="num">{Number(h.quantity).toFixed(2)}</td>
                        <td className="num font-bold">{formatMoney(h.market_value)}</td>
                        <td className={`num ${ret >= 0 ? "text-positive" : "text-negative"}`}>
                          {formatMoney(ret)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Accounts Breakdown */}
        <section className="panel" style={{ margin: 0 }}>
          <div className="panel-header">
            <h3>Accounts Breakdown</h3>
            <button type="button" className="link" onClick={() => onNavigate("holdings")}>
              Manage Accounts &rarr;
            </button>
          </div>

          {!dashboard?.accounts?.length ? (
            <div className="empty" style={{ padding: "2rem" }}>
              <p>No investment accounts configured.</p>
              <button
                type="button"
                className="secondary"
                style={{ marginTop: "1rem" }}
                onClick={() => onNavigate("holdings")}
              >
                Add Account or Position
              </button>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Type</th>
                    <th className="num">Positions</th>
                    <th className="num">Market Value</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.accounts || []).map((acc, idx) => (
                    <tr key={idx}>
                      <td>
                        <strong>{acc.account_name}</strong>
                      </td>
                      <td>
                        <span className="status info">{acc.account_type || "Standard"}</span>
                      </td>
                      <td className="num">{acc.positions}</td>
                      <td className="num font-bold">{formatMoney(acc.market_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Quick Launch Cards */}
      <h2 style={{ fontSize: "1.2rem", margin: "2.5rem 0 1rem", fontWeight: 700 }}>
        Quick Management Desks
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
        <div
          className="panel"
          style={{ cursor: "pointer", margin: 0 }}
          onClick={() => onNavigate("chequing")}
        >
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <Wallet size={24} style={{ color: "var(--accent)" }} />
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Chequing Desk</h3>
              <p className="fine" style={{ margin: "0.2rem 0 0" }}>
                WealthSimple cash flow, categorization & balances
              </p>
            </div>
          </div>
        </div>

        <div
          className="panel"
          style={{ cursor: "pointer", margin: 0 }}
          onClick={() => onNavigate("credit-card")}
        >
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <CreditCard size={24} style={{ color: "#ffd391" }} />
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Credit Card Desk</h3>
              <p className="fine" style={{ margin: "0.2rem 0 0" }}>
                Rogers Bank & Scotiabank spending breakdown
              </p>
            </div>
          </div>
        </div>

        <div
          className="panel"
          style={{ cursor: "pointer", margin: 0 }}
          onClick={() => onNavigate("acb")}
        >
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <TrendingUp size={24} style={{ color: "#91b6ff" }} />
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>ACB & Capital Gains</h3>
              <p className="fine" style={{ margin: "0.2rem 0 0" }}>
                Adjusted cost base calculation for non-registered CRA tax filing
              </p>
            </div>
          </div>
        </div>

        <div
          className="panel"
          style={{ cursor: "pointer", margin: 0 }}
          onClick={() => onNavigate("import")}
        >
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <PieChart size={24} style={{ color: "var(--accent)" }} />
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Import Wizard & Backup</h3>
              <p className="fine" style={{ margin: "0.2rem 0 0" }}>
                Staged CSV/PDF review, database backup export & restore
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
