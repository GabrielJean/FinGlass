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
  const ccDebt = Number(ccDashboard?.total_spending || 0);
  const cheqBalance = Number(cheqDashboard?.summary?.net_flow || 0);
  const netWorthEstimate = totalMarket - ccDebt;

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
            <span className="status positive">Tax-Free</span>
          </div>
          <span className="kpi-val" style={{ color: "var(--accent)" }}>
            {tfsaSummary?.total_remaining !== undefined
              ? formatMoney(tfsaSummary.total_remaining)
              : tfsaSummary?.current_year_room !== undefined
              ? formatMoney(tfsaSummary.current_year_room)
              : "Set Room"}
          </span>
          <span className="kpi-sub">
            Contributed: {formatMoney(tfsaSummary?.current_year_contributions || 0)}
          </span>
        </div>

        <div
          className="kpi-card"
          style={{ cursor: "pointer", transition: "transform 0.15s ease" }}
          onClick={() => onNavigate("rrsp")}
          title="Click to view RRSP details"
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="kpi-label">RRSP Room</span>
            <span className="status info">Tax-Deferred</span>
          </div>
          <span className="kpi-val" style={{ color: "#91b6ff" }}>
            {rrspSummary?.total_remaining !== undefined
              ? formatMoney(rrspSummary.total_remaining)
              : rrspSummary?.current_year_room !== undefined
              ? formatMoney(rrspSummary.current_year_room)
              : "Set Room"}
          </span>
          <span className="kpi-sub">
            Unused contributions: {formatMoney(rrspSummary?.unused_contributions || 0)}
          </span>
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
            {fhsaSummary?.total_remaining !== undefined
              ? formatMoney(fhsaSummary.total_remaining)
              : fhsaSummary?.current_year_room !== undefined
              ? formatMoney(fhsaSummary.current_year_room)
              : "Set Room"}
          </span>
          <span className="kpi-sub">
            Lifetime remaining: {formatMoney(fhsaSummary?.lifetime_room_remaining || 40000)}
          </span>
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
