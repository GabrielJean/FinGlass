import React, { useEffect, useState, useMemo } from "react";
import { api } from "../api";
import { formatMoney, formatPercent, formatDate } from "../utils/formatters";
import { RefreshCw, Plus, Search, Trash2, Edit2, DollarSign, ExternalLink, PieChart } from "lucide-react";
import { Bar, Doughnut } from "react-chartjs-2";
import "../components/charts/chartSetup";
import {
  CHART_PALETTE,
  formatCompactMoney,
  commonTooltipOptions,
  commonScaleOptions,
} from "../components/charts/chartSetup";
import { CollapsibleChartSection } from "../components/charts/CollapsibleChartSection";
import { ChartCard } from "../components/charts/ChartCard";

export function HoldingsView({ onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [holdings, setHoldings] = useState([]);
  const [cashAccounts, setCashAccounts] = useState([]);
  const [filterAccount, setFilterAccount] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshingQuotes, setRefreshingQuotes] = useState(false);

  // Quote lookup
  const [lookupSymbol, setLookupSymbol] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isCashModalOpen, setIsCashModalOpen] = useState(false);
  const [editingHolding, setEditingHolding] = useState(null);

  // Form state
  const [form, setForm] = useState({
    as_of: new Date().toISOString().split("T")[0],
    account_name: "",
    account_type: "TFSA",
    account_classification: "Registered",
    symbol: "",
    security_name: "",
    quantity: "",
    book_value_cad: "",
    market_value: "",
    market_price: "",
  });

  // Cash form state
  const [cashForm, setCashForm] = useState({
    as_of: new Date().toISOString().split("T")[0],
    balance: "",
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const holdingsRes = await api.holdings.list();
      const rows = Array.isArray(holdingsRes) ? holdingsRes : (holdingsRes?.rows || []);
      setHoldings(rows);
      const cashList = rows.filter((h) => h.symbol === "CASH");
      setCashAccounts(cashList);
    } catch (err) {
      setError(err.message || "Failed to load holdings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRefreshQuotes = async () => {
    setRefreshingQuotes(true);
    setNotice("");
    try {
      const res = await api.holdings.refreshMarketValues();
      setNotice(`Updated ${res.rows_updated} positions across ${res.symbols_priced} symbols from market data.`);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to refresh quotes.");
    } finally {
      setRefreshingQuotes(false);
    }
  };

  const handleLookupQuote = async (e) => {
    e.preventDefault();
    if (!lookupSymbol.trim()) return;
    setLookupLoading(true);
    setLookupResult(null);
    try {
      const quote = await api.holdings.getQuote(lookupSymbol.trim());
      setLookupResult(quote);
    } catch (err) {
      setError(`Quote lookup: ${err.message}`);
    } finally {
      setLookupLoading(false);
    }
  };

  const handleDelete = async (id, symbol) => {
    if (!window.confirm(`Are you sure you want to delete position ${symbol}?`)) return;
    try {
      await api.holdings.delete(id);
      setNotice(`Deleted position ${symbol}.`);
      setHoldings(holdings.filter((h) => h.id !== id));
    } catch (err) {
      setError(err.message || "Failed to delete holding.");
    }
  };

  const handleSaveHolding = async (e) => {
    e.preventDefault();
    setError("");
    try {
      if (editingHolding) {
        await api.holdings.update(editingHolding.id, form);
        setNotice(`Updated ${form.symbol}.`);
      } else {
        await api.holdings.create(form);
        setNotice(`Added position ${form.symbol}.`);
      }
      setIsAddModalOpen(false);
      setEditingHolding(null);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to save position.");
    }
  };

  const handleSaveCash = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api.holdings.upsertCashAccount({
        as_of: cashForm.as_of,
        amount: Number(cashForm.balance),
      });
      setNotice("Saved cash position.");
      setIsCashModalOpen(false);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to save cash position.");
    }
  };

  const openEditModal = (h) => {
    setEditingHolding(h);
    setForm({
      as_of: h.as_of,
      account_name: h.account_name,
      account_type: h.account_type || "TFSA",
      account_classification: h.account_classification || "Registered",
      symbol: h.symbol,
      security_name: h.security_name || "",
      quantity: h.quantity,
      book_value_cad: h.book_value_cad,
      market_value: h.market_value,
      market_price: (h.market_value / (h.quantity || 1)).toFixed(2),
    });
    setIsAddModalOpen(true);
  };

  const rawHoldings = Array.isArray(holdings) ? holdings : [];

  const filteredHoldings = rawHoldings.filter((h) => {
    if (filterAccount !== "all" && h.account_type !== filterAccount && h.account_name !== filterAccount) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        h.symbol?.toLowerCase().includes(q) ||
        h.security_name?.toLowerCase().includes(q) ||
        h.account_name?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Calculate totals
  const totalMarketVal = filteredHoldings.reduce((sum, h) => sum + Number(h.market_value || 0), 0);
  const totalBookVal = filteredHoldings.reduce((sum, h) => sum + Number(h.book_value_cad || 0), 0);
  const totalReturn = totalMarketVal - totalBookVal;
  const returnPct = totalBookVal > 0 ? (totalReturn / totalBookVal) * 100 : 0;

  // Account types list for filter
  const accountTypes = Array.from(new Set(rawHoldings.map((h) => h.account_type || h.account_name).filter(Boolean)));

  // Chart 1: Symbol Allocation
  const symbolAllocationData = useMemo(() => {
    if (!rawHoldings.length) return null;
    const symbolMap = {};
    rawHoldings.forEach((h) => {
      const sym = h.symbol || "Unknown";
      symbolMap[sym] = (symbolMap[sym] || 0) + Number(h.market_value || 0);
    });

    const sorted = Object.entries(symbolMap)
      .map(([symbol, val]) => ({ symbol, val }))
      .sort((a, b) => b.val - a.val);

    const top = sorted.slice(0, 7);
    const otherVal = sorted.slice(7).reduce((sum, item) => sum + item.val, 0);

    const labels = top.map((item) => item.symbol);
    const data = top.map((item) => item.val);
    if (otherVal > 0) {
      labels.push("Other Holdings");
      data.push(otherVal);
    }

    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor: CHART_PALETTE.slice(0, labels.length),
          borderColor: "transparent",
          borderWidth: 0,
          spacing: 3,
        },
      ],
    };
  }, [rawHoldings]);

  const symbolAllocationOptions = useMemo(() => {
    const total = rawHoldings.reduce((sum, h) => sum + Number(h.market_value || 0), 0);
    return {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: {
          position: "right",
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            color: "#9bb2d1",
            font: { size: 11 },
            padding: 8,
          },
        },
        tooltip: {
          ...commonTooltipOptions,
          callbacks: {
            label: (ctx) => {
              const val = Number(ctx.raw || 0);
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : "0.0";
              return `${ctx.label}: ${formatMoney(val)} (${pct}%)`;
            },
          },
        },
      },
    };
  }, [rawHoldings]);

  // Chart 2: Account Breakdown
  const accountBreakdownData = useMemo(() => {
    if (!rawHoldings.length) return null;
    const accMap = {};
    rawHoldings.forEach((h) => {
      const name = h.account_name || h.account_type || "Standard";
      accMap[name] = (accMap[name] || 0) + Number(h.market_value || 0);
    });

    const entries = Object.entries(accMap)
      .map(([name, val]) => ({ name, val }))
      .sort((a, b) => b.val - a.val);

    return {
      labels: entries.map((e) => e.name),
      datasets: [
        {
          label: "Market Value",
          data: entries.map((e) => e.val),
          backgroundColor: "rgba(56, 189, 248, 0.5)",
          borderColor: "#38bdf8",
          borderWidth: 1.5,
          borderRadius: 6,
        },
      ],
    };
  }, [rawHoldings]);

  const accountBreakdownOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...commonTooltipOptions,
          callbacks: {
            label: (ctx) => `Market Value: ${formatMoney(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: {
          ...commonScaleOptions,
          grid: { display: false },
        },
        y: {
          ...commonScaleOptions,
          ticks: {
            ...commonScaleOptions.ticks,
            callback: (val) => formatCompactMoney(val),
          },
        },
      },
    };
  }, []);

  return (
    <div style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}>
      <div className="top-bar">
        <div>
          <p className="eyebrow">PORTFOLIO POSITIONS</p>
          <h1>Holdings & Positions</h1>
          <p>Real-time tracked positions with automated market quote feeds.</p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="secondary"
            disabled={refreshingQuotes}
            onClick={handleRefreshQuotes}
          >
            <RefreshCw size={15} className={refreshingQuotes ? "spin" : ""} />
            {refreshingQuotes ? "Refreshing..." : "Refresh Quotes"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const existingCash = rawHoldings.find((h) => h.symbol === "CASH");
              setCashForm({
                as_of: existingCash ? existingCash.as_of : new Date().toISOString().split("T")[0],
                balance: existingCash ? existingCash.market_value : "",
              });
              setIsCashModalOpen(true);
            }}
          >
            <DollarSign size={15} />
            Cash Position
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingHolding(null);
              setForm({
                as_of: new Date().toISOString().split("T")[0],
                account_name: "",
                account_type: "TFSA",
                account_classification: "Registered",
                symbol: "",
                security_name: "",
                quantity: "",
                book_value_cad: "",
                market_value: "",
                market_price: "",
              });
              setIsAddModalOpen(true);
            }}
          >
            <Plus size={15} />
            Add Position
          </button>
        </div>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: "1rem" }}>{error}</div>}
      {notice && (
        <div className="success-banner" style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between" }}>
          <span>{notice}</span>
          <button type="button" className="link" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      {/* KPI Row */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Holdings Value</span>
          <span className="kpi-val">{formatMoney(totalMarketVal)}</span>
          <span className="kpi-sub">Book: <strong className="num">{formatMoney(totalBookVal)}</strong></span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Unrealized Gain / Loss</span>
          <span className={`kpi-val ${totalReturn >= 0 ? "text-positive" : "text-negative"}`}>
            {formatMoney(totalReturn)}
          </span>
          <span className={`kpi-sub ${totalReturn >= 0 ? "positive" : "negative"}`}>
            {formatPercent(returnPct)} overall return
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Total Positions</span>
          <span className="kpi-val">{filteredHoldings.length}</span>
          <span className="kpi-sub">In selected view</span>
        </div>
      </section>

      {/* Quote Quick Checker Bar */}
      <section className="panel" style={{ padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
        <form onSubmit={handleLookupQuote} style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span className="fine" style={{ fontWeight: 600, color: "var(--text-main)" }}>
            Market Quote Lookup:
          </span>
          <input
            type="text"
            placeholder="e.g. VFV.TO, AAPL"
            value={lookupSymbol}
            onChange={(e) => setLookupSymbol(e.target.value)}
            style={{ width: "160px", padding: "0.5rem 0.75rem" }}
          />
          <button type="submit" className="secondary" disabled={lookupLoading} style={{ padding: "0.5rem 0.9rem" }}>
            {lookupLoading ? "Looking up..." : "Get Quote"}
          </button>

          {lookupResult && (
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginLeft: "auto" }}>
              <span className="status positive">{lookupResult.symbol}</span>
              <strong className="num" style={{ fontSize: "1.1rem" }}>
                ${Number(lookupResult.price).toFixed(2)} {lookupResult.currency}
              </strong>
              {lookupResult.change_pct !== undefined && (
                <span className={`fine ${lookupResult.change_pct >= 0 ? "text-positive" : "text-negative"}`}>
                  {formatPercent(lookupResult.change_pct)}
                </span>
              )}
            </div>
          )}
        </form>
      </section>

      {/* Collapsible Portfolio Allocation Section */}
      <CollapsibleChartSection
        title="Portfolio Allocation & Distribution"
        subtitle="Visual breakdown of assets and account holdings"
        storageKey="finglass_collapse_holdings_charts"
        chartCount={2}
        icon={PieChart}
      >
        <div className="chart-grid">
          <ChartCard
            title="Asset Allocation by Symbol"
            subtitle="Market value distribution by stock/ETF symbol"
            height={260}
            empty={!symbolAllocationData}
            emptyMessage="No positions recorded to display allocation."
          >
            {symbolAllocationData && (
              <Doughnut data={symbolAllocationData} options={symbolAllocationOptions} />
            )}
          </ChartCard>

          <ChartCard
            title="Market Value by Account"
            subtitle="Total value held across investment accounts"
            height={260}
            empty={!accountBreakdownData}
            emptyMessage="No accounts recorded to display breakdown."
          >
            {accountBreakdownData && (
              <Bar data={accountBreakdownData} options={accountBreakdownOptions} />
            )}
          </ChartCard>
        </div>
      </CollapsibleChartSection>

      {/* Filter and Search Bar */}
      <div className="filter-bar">
        <div className="filter-group">
          <select
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
          >
            <option value="all">All Accounts ({holdings.length})</option>
            {accountTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="search-input-wrap">
          <Search size={15} />
          <input
            type="text"
            placeholder="Search symbol or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Holdings Table */}
      <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="loading" style={{ minHeight: "200px" }}>Loading holdings...</div>
        ) : filteredHoldings.length === 0 ? (
          <div className="empty">
            <h3>No positions found</h3>
            <p>Add a new position manually or import your Wealthsimple statements.</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: "none" }}>
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Security</th>
                  <th>Account</th>
                  <th className="num">Shares</th>
                  <th className="num">Price</th>
                  <th className="num">Book Value</th>
                  <th className="num">Market Value</th>
                  <th className="num">Return</th>
                  <th style={{ textAlign: "center", width: "70px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredHoldings.map((h) => {
                  const ret = Number(h.unrealized_return || 0);
                  const isPos = ret >= 0;
                  const price = Number(h.quantity) > 0 ? (Number(h.market_value) / Number(h.quantity)) : 0;
                  const retPct = Number(h.book_value_cad) > 0 ? (ret / Number(h.book_value_cad)) * 100 : 0;

                  return (
                    <tr key={h.id}>
                      <td>
                        <button
                          type="button"
                          className="link mono"
                          style={{ fontWeight: 800, padding: 0 }}
                          onClick={() => onNavigate("acb", { symbol: h.symbol })}
                          title="View ACB Ledger for this security"
                        >
                          {h.symbol}
                        </button>
                      </td>
                      <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h.security_name || ""}>
                        {h.security_name || "-"}
                      </td>
                      <td>
                        <span
                          className="status info"
                          style={{
                            maxWidth: 130,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "inline-block",
                            verticalAlign: "middle",
                          }}
                          title={h.account_name || h.account_type}
                        >
                          {h.account_name || h.account_type}
                        </span>
                      </td>
                      <td className="num">{Number(h.quantity).toFixed(4)}</td>
                      <td className="num">${price.toFixed(2)}</td>
                      <td className="num">{formatMoney(h.book_value_cad)}</td>
                      <td className="num font-bold">{formatMoney(h.market_value)}</td>
                      <td className={`num ${isPos ? "text-positive" : "text-negative"}`}>
                        <strong>{formatMoney(ret)}</strong>
                        <div className="fine" style={{ color: isPos ? "var(--positive)" : "var(--negative)" }}>
                          {formatPercent(retPct)}
                        </div>
                      </td>
                      <td style={{ textAlign: "center", whiteSpace: "nowrap", width: "70px" }}>
                        <button
                          type="button"
                          className="link"
                          onClick={() => openEditModal(h)}
                          title="Edit Position"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          className="link destructive"
                          onClick={() => handleDelete(h.id, h.symbol)}
                          title="Delete Position"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add / Edit Holding Modal */}
      {isAddModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAddModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">{editingHolding ? "UPDATE POSITION" : "NEW HOLDING"}</p>
            <h2>{editingHolding ? `Edit ${form.symbol}` : "Add Investment Position"}</h2>

            <form onSubmit={handleSaveHolding} className="stack">
              <div className="form-grid-2">
                <label>
                  <span>Ticker Symbol</span>
                  <input
                    type="text"
                    required
                    placeholder="e.g. VFV.TO"
                    value={form.symbol}
                    onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
                  />
                </label>
                <label>
                  <span>Account Name</span>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Wealthsimple TFSA"
                    value={form.account_name}
                    onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                  />
                </label>
              </div>

              <div className="form-grid-2">
                <label>
                  <span>Account Type</span>
                  <select
                    value={form.account_type}
                    onChange={(e) => setForm({ ...form, account_type: e.target.value })}
                  >
                    <option value="TFSA">TFSA</option>
                    <option value="RRSP">RRSP</option>
                    <option value="FHSA">FHSA</option>
                    <option value="Non-Registered">Non-Registered / Margin</option>
                    <option value="Corporate">Corporate</option>
                  </select>
                </label>

                <label>
                  <span>Security Name</span>
                  <input
                    type="text"
                    placeholder="e.g. Vanguard S&P 500 ETF"
                    value={form.security_name}
                    onChange={(e) => setForm({ ...form, security_name: e.target.value })}
                  />
                </label>
              </div>

              <div className="form-grid-3">
                <label>
                  <span>Quantity (Shares)</span>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="100"
                    value={form.quantity}
                    onChange={(e) => {
                      const qty = e.target.value;
                      const price = form.market_price;
                      const mv = qty && price ? (Number(qty) * Number(price)).toFixed(2) : form.market_value;
                      setForm({ ...form, quantity: qty, market_value: mv });
                    }}
                  />
                </label>

                <label>
                  <span>Book Value (Cost)</span>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="CAD $"
                    value={form.book_value_cad}
                    onChange={(e) => setForm({ ...form, book_value_cad: e.target.value })}
                  />
                </label>

                <label>
                  <span>Market Value</span>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="CAD $"
                    value={form.market_value}
                    onChange={(e) => setForm({ ...form, market_value: e.target.value })}
                  />
                </label>
              </div>

              <label>
                <span>As of Date</span>
                <input
                  type="date"
                  required
                  value={form.as_of}
                  onChange={(e) => setForm({ ...form, as_of: e.target.value })}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsAddModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit">
                  {editingHolding ? "Save Changes" : "Create Position"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cash Account Modal */}
      {isCashModalOpen && (
        <div className="modal-overlay" onClick={() => setIsCashModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">CASH POSITION</p>
            <h2>Manage Cash Balance</h2>
            <p className="fine" style={{ marginBottom: "1rem" }}>
              Set your overall cash reserve for this snapshot date. Set balance to 0 to remove.
            </p>

            <form onSubmit={handleSaveCash} className="stack">
              <label>
                <span>Cash Balance (CAD)</span>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={cashForm.balance}
                  onChange={(e) => setCashForm({ ...cashForm, balance: e.target.value })}
                />
              </label>

              <label>
                <span>As of Date</span>
                <input
                  type="date"
                  required
                  value={cashForm.as_of}
                  onChange={(e) => setCashForm({ ...cashForm, as_of: e.target.value })}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsCashModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Save Cash Position</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

