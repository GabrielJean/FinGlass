import React, { useEffect, useState, useRef, useMemo } from "react";
import { api } from "../api";
import { formatMoney, formatDate } from "../utils/formatters";
import { QUICK_DATE_RANGES, computeQuickDateRange } from "../utils/dateFilters";
import {
  Upload,
  Search,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  RotateCcw,
  BarChart3,
  PieChart,
} from "lucide-react";
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

export function CreditCardView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [dashboard, setDashboard] = useState(null);
  const [cards, setCards] = useState([]);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);

  // Date & Filter state
  const [quickDateRange, setQuickDateRange] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedCard, setSelectedCard] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Multi-select
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkCategory, setBulkCategory] = useState("");

  // Modals & Upload
  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const [newCardForm, setNewCardForm] = useState({ label: "", provider: "rogers_bank" });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load cards and category metadata once on mount
  const loadMetadata = async () => {
    try {
      const [cardsRes, catRes] = await Promise.all([
        api.creditCard.getCards(),
        api.creditCard.getCategories(),
      ]);
      setCards(Array.isArray(cardsRes) ? cardsRes : (cardsRes?.cards || []));
      setCategories(Array.isArray(catRes) ? catRes : (catRes?.categories || []));
    } catch (err) {
      console.error("Failed to load credit card metadata:", err);
    }
  };

  useEffect(() => {
    loadMetadata();
  }, []);

  // Build query string for dashboard & transactions
  const buildQueryParams = () => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    if (selectedCard) params.set("card_label", selectedCard);
    if (selectedCategory) params.set("category", selectedCategory);
    if (debouncedSearch.trim()) {
      params.set("search", debouncedSearch.trim());
      params.set("merchant", debouncedSearch.trim());
    }
    if (includeHidden) params.set("include_hidden", "1");
    return params.toString();
  };

  // Main data fetching effect synchronized on all filter changes
  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const q = buildQueryParams();
      const [dashRes, txRes] = await Promise.all([
        api.creditCard.getDashboard(q),
        api.creditCard.getTransactions(q),
      ]);
      setDashboard(dashRes);
      setTransactions(Array.isArray(txRes) ? txRes : (txRes?.transactions || txRes?.rows || []));
      setSelectedIds(new Set());
    } catch (err) {
      setError(err.message || "Failed to load credit card data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate, selectedCard, selectedCategory, includeHidden, debouncedSearch]);

  const handleQuickDateSelect = (rangeId) => {
    setQuickDateRange(rangeId);
    const { startDate: s, endDate: e } = computeQuickDateRange(rangeId);
    setStartDate(s);
    setEndDate(e);
  };

  const handleCustomStartDateChange = (e) => {
    setStartDate(e.target.value);
    setQuickDateRange("");
  };

  const handleCustomEndDateChange = (e) => {
    setEndDate(e.target.value);
    setQuickDateRange("");
  };

  const handleResetFilters = () => {
    setQuickDateRange("all");
    setStartDate("");
    setEndDate("");
    setSelectedCard("");
    setSelectedCategory("");
    setSearchQuery("");
    setDebouncedSearch("");
    setIncludeHidden(false);
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const list = Array.isArray(transactions) ? transactions : [];
      setSelectedIds(new Set(list.map((t) => t.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleSelectOne = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleToggleHide = async (id, currentHidden) => {
    try {
      await api.creditCard.setHidden(id, !currentHidden);
      setTransactions((prev) =>
        (Array.isArray(prev) ? prev : []).map((t) => (t.id === id ? { ...t, is_hidden: !currentHidden } : t))
      );
      fetchData();
    } catch (err) {
      setError(err.message || "Failed to update visibility.");
    }
  };

  const handleBulkHide = async (hideState) => {
    if (!selectedIds.size) return;
    try {
      await api.creditCard.hideMany(Array.from(selectedIds), hideState);
      setNotice(`${hideState ? "Hidden" : "Unhidden"} ${selectedIds.size} transactions.`);
      fetchData();
    } catch (err) {
      setError(err.message || "Bulk hide failed.");
    }
  };

  const handleBulkRecategorize = async () => {
    if (!selectedIds.size || !bulkCategory) return;
    try {
      await api.creditCard.recategorize(Array.from(selectedIds), bulkCategory);
      setNotice(`Recategorized ${selectedIds.size} transactions to "${bulkCategory}".`);
      setBulkCategory("");
      fetchData();
      loadMetadata();
    } catch (err) {
      setError(err.message || "Bulk recategorize failed.");
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected transactions?`)) return;
    try {
      await api.creditCard.deleteMany(Array.from(selectedIds));
      setNotice(`Deleted ${selectedIds.size} transactions.`);
      fetchData();
      loadMetadata();
    } catch (err) {
      setError(err.message || "Bulk delete failed.");
    }
  };

  const handleDeleteOne = async (id) => {
    if (!window.confirm("Delete this transaction?")) return;
    try {
      await api.creditCard.deleteTransaction(id);
      setTransactions((prev) => (Array.isArray(prev) ? prev : []).filter((t) => t.id !== id));
      setNotice("Transaction deleted.");
      fetchData();
      loadMetadata();
    } catch (err) {
      setError(err.message || "Failed to delete transaction.");
    }
  };

  const handleCreateCard = async (e) => {
    e.preventDefault();
    if (!newCardForm.label.trim()) return;
    try {
      await api.creditCard.createCard({
        label: newCardForm.label.trim(),
        provider: newCardForm.provider,
      });
      setNotice(`Created card "${newCardForm.label}".`);
      setNewCardForm({ label: "", provider: "rogers_bank" });
      setIsAddCardOpen(false);
      loadMetadata();
      fetchData();
    } catch (err) {
      setError(err.message || "Failed to create card.");
    }
  };

  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    if (selectedCard) formData.append("card_label", selectedCard);

    try {
      const res = await api.creditCard.importRogersCsv(formData);
      setNotice(`Successfully imported ${res.imported_count || res.count || "transactions"}.`);
      loadMetadata();
      fetchData();
    } catch (err) {
      setError(err.message || "CSV Import failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading && !dashboard) {
    return <div className="loading">Loading credit card data...</div>;
  }

  const summary = dashboard?.summary || {};
  const insights = dashboard?.insights || {};
  const totalSpending = Number(summary.total_expenses ?? summary.total_spending ?? dashboard?.total_spending ?? 0);
  const totalRewards = Number(insights.total_rewards ?? dashboard?.total_rewards ?? 0);
  const totalTxCount = summary.transactions ?? summary.transaction_count ?? dashboard?.transaction_count ?? transactions.length;

  // Chart 1: Monthly expenses
  const monthlyChartData = useMemo(() => {
    const list = dashboard?.monthly || [];
    return {
      labels: list.map((m) => m.month),
      datasets: [
        {
          label: "Expenses",
          data: list.map((m) => Number(m.expenses || 0)),
          backgroundColor: "rgba(248, 113, 113, 0.45)",
          borderColor: "#f87171",
          borderWidth: 1.5,
          borderRadius: 6,
        },
      ],
    };
  }, [dashboard?.monthly]);

  const monthlyChartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...commonTooltipOptions,
          callbacks: {
            label: (ctx) => `Expenses: ${formatMoney(ctx.raw)}`,
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

  // Chart 2: Category breakdown
  const categoryChartData = useMemo(() => {
    const rawCategories = dashboard?.categories || [];
    if (!rawCategories.length) return null;

    const sortedCats = [...rawCategories].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    const topCats = sortedCats.slice(0, 7);
    const otherAmount = sortedCats.slice(7).reduce((sum, c) => sum + Number(c.amount || 0), 0);

    const labels = topCats.map((c) => c.merchant_category || "Uncategorized");
    const data = topCats.map((c) => Number(c.amount || 0));

    if (otherAmount > 0) {
      labels.push("Other Categories");
      data.push(otherAmount);
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
  }, [dashboard?.categories]);

  const categoryChartOptions = useMemo(() => {
    const total = (dashboard?.categories || []).reduce((sum, c) => sum + Number(c.amount || 0), 0);
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
  }, [dashboard?.categories]);

  // Chart 3: Top Merchants
  const merchantChartData = useMemo(() => {
    const rawMerchants = dashboard?.top_merchants || dashboard?.merchants || [];
    if (!rawMerchants.length) return null;

    const topMerchants = [...rawMerchants]
      .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
      .slice(0, 7);

    return {
      labels: topMerchants.map((m) => m.merchant_name || "Unknown"),
      datasets: [
        {
          label: "Spend",
          data: topMerchants.map((m) => Number(m.amount || 0)),
          backgroundColor: "rgba(56, 189, 248, 0.45)",
          borderColor: "#38bdf8",
          borderWidth: 1.5,
          borderRadius: 5,
        },
      ],
    };
  }, [dashboard?.top_merchants, dashboard?.merchants]);

  const merchantChartOptions = useMemo(() => {
    return {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...commonTooltipOptions,
          callbacks: {
            label: (ctx) => `Spend: ${formatMoney(ctx.raw)}`,
          },
        },
      },
      scales: {
        y: {
          ...commonScaleOptions,
          grid: { display: false },
        },
        x: {
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
    <div>
      <div className="top-bar">
        <div>
          <p className="eyebrow">LIABILITIES & SPENDING</p>
          <h1>Credit Card Tracker</h1>
          <p>Credit & spend card tracking, merchant categories, and cash back rewards.</p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleCsvUpload}
          />
          <button
            type="button"
            className="secondary"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={15} />
            {uploading ? "Importing..." : "Import Card Statement CSV"}
          </button>
          <button
            type="button"
            onClick={() => setIsAddCardOpen(true)}
          >
            <Plus size={15} />
            Add Card
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

      {/* KPI Cards */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Period Spending</span>
          <span className="kpi-val text-negative">
            {formatMoney(totalSpending)}
          </span>
          <span className="kpi-sub">Total posted charges</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Rewards Earned</span>
          <span className="kpi-val text-positive">
            {formatMoney(totalRewards)}
          </span>
          <span className="kpi-sub">Cash back / loyalty points</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Transactions</span>
          <span className="kpi-val">{totalTxCount}</span>
          <span className="kpi-sub">In selected filter</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Cards Tracked</span>
          <span className="kpi-val">{cards.length || 1}</span>
          <span className="kpi-sub">Active payment instruments</span>
        </div>
      </section>

      {/* Filter and Bulk Bar */}
      <section className="panel" style={{ padding: "1.1rem 1.25rem", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          {/* Quick Date Presets & Reset Button */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
            <div className="quick-date-row">
              <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginRight: "0.25rem", fontWeight: 600 }}>Period:</span>
              {QUICK_DATE_RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`pill-btn ${quickDateRange === r.id ? "active" : ""}`}
                  onClick={() => handleQuickDateSelect(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn-reset-filters"
              onClick={handleResetFilters}
              title="Reset all filters"
            >
              <RotateCcw size={13} /> Reset Filters
            </button>
          </div>

          {/* Date Pickers, Selects, Search, and Show Hidden */}
          <div className="filter-bar" style={{ marginBottom: 0, gap: "0.65rem" }}>
            <div className="filter-group">
              <div className="date-filter-group">
                <span>From</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={handleCustomStartDateChange}
                  aria-label="From date"
                />
                <span>To</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={handleCustomEndDateChange}
                  aria-label="To date"
                />
              </div>

              <select
                value={selectedCard}
                onChange={(e) => setSelectedCard(e.target.value)}
              >
                <option value="">All Credit Cards</option>
                {(Array.isArray(cards) ? cards : []).map((c, idx) => (
                  <option key={c.id || c.label || idx} value={c.label || c}>{c.label || c}</option>
                ))}
              </select>

              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="">All Categories</option>
                {(Array.isArray(categories) ? categories : []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <label className="checkbox-label" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={includeHidden}
                  onChange={(e) => setIncludeHidden(e.target.checked)}
                />
                Show Hidden
              </label>
            </div>

            <div className="search-input-wrap">
              <Search size={15} />
              <input
                type="text"
                placeholder="Search merchant..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Bulk Action Controls */}
        {selectedIds.size > 0 && (
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "1rem", paddingTop: "0.8rem", borderTop: "1px solid var(--border-dim)", flexWrap: "wrap" }}>
            <span className="status info">{selectedIds.size} selected</span>
            <button type="button" className="secondary" onClick={() => handleBulkHide(true)} style={{ padding: "0.45rem 0.8rem", fontSize: "0.82rem" }}>
              <EyeOff size={13} /> Hide Selected
            </button>
            <button type="button" className="secondary" onClick={() => handleBulkHide(false)} style={{ padding: "0.45rem 0.8rem", fontSize: "0.82rem" }}>
              <Eye size={13} /> Unhide Selected
            </button>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <select
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
                style={{ padding: "0.45rem 0.6rem", fontSize: "0.82rem", width: "auto" }}
              >
                <option value="">Choose Category...</option>
                {(Array.isArray(categories) ? categories : []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button
                type="button"
                className="secondary"
                disabled={!bulkCategory}
                onClick={handleBulkRecategorize}
                style={{ padding: "0.45rem 0.8rem", fontSize: "0.82rem" }}
              >
                Apply Category
              </button>
            </div>
            <button
              type="button"
              className="danger"
              onClick={handleBulkDelete}
              style={{ padding: "0.45rem 0.8rem", fontSize: "0.82rem", marginLeft: "auto" }}
            >
              <Trash2 size={13} /> Delete Selected
            </button>
          </div>
        )}
      </section>

      {/* Collapsible Spending Analytics Section */}
      <CollapsibleChartSection
        title="Spending Analytics & Trends"
        subtitle="Monthly outflow velocity, category breakdown, and top merchants"
        storageKey="finglass_collapse_creditcard_charts"
        chartCount={3}
        icon={PieChart}
      >
        <div className="chart-grid">
          <ChartCard
            title="Monthly Spending Trend"
            subtitle="Posted expenses per billing month"
            height={260}
            empty={!monthlyChartData.labels.length}
            emptyMessage="No monthly spend data available for the active filters."
          >
            {monthlyChartData.labels.length > 0 && (
              <Bar data={monthlyChartData} options={monthlyChartOptions} />
            )}
          </ChartCard>

          <ChartCard
            title="Top Spending Categories"
            subtitle="Outflow distributed by merchant classification"
            height={260}
            empty={!categoryChartData}
            emptyMessage="No categorized transactions available."
          >
            {categoryChartData && (
              <Doughnut data={categoryChartData} options={categoryChartOptions} />
            )}
          </ChartCard>

          <ChartCard
            title="Top Merchants by Outflow"
            subtitle="Largest spend destinations"
            height={260}
            empty={!merchantChartData}
            emptyMessage="No merchant spend data available."
          >
            {merchantChartData && (
              <Bar data={merchantChartData} options={merchantChartOptions} />
            )}
          </ChartCard>
        </div>
      </CollapsibleChartSection>

      {/* Transactions Table */}
      <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="loading" style={{ minHeight: "200px" }}>Loading transactions...</div>
        ) : transactions.length === 0 ? (
          <div className="empty">
            <h3>No credit card transactions</h3>
            <p>No transactions match the selected filters or statement has not been uploaded yet.</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: "none" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "35px", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.size === transactions.length && transactions.length > 0}
                      onChange={handleSelectAll}
                    />
                  </th>
                  <th>Date</th>
                  <th>Merchant</th>
                  <th>Category</th>
                  <th>Card</th>
                  <th className="num">Amount</th>
                  <th style={{ textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(transactions) ? transactions : []).map((t) => {
                  const amt = Number(t.amount || 0);
                  const isSelected = selectedIds.has(t.id);

                  return (
                    <tr key={t.id} style={{ opacity: t.is_hidden ? 0.45 : 1, background: isSelected ? "rgba(28, 49, 80, 0.4)" : undefined }}>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(t.id)}
                        />
                      </td>
                      <td className="mono">{formatDate(t.transaction_date)}</td>
                      <td>
                        <strong>{t.merchant_name || t.description || "-"}</strong>
                        {t.is_hidden && <span className="fine" style={{ marginLeft: 6 }}>(hidden)</span>}
                      </td>
                      <td>
                        <span className="status info">{t.merchant_category || t.category || "Uncategorized"}</span>
                      </td>
                      <td>{t.card_label || t.provider || "Card"}</td>
                      <td className="num font-bold text-negative">
                        {formatMoney(amt)}
                      </td>
                      <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          className="link"
                          onClick={() => handleToggleHide(t.id, t.is_hidden)}
                          title={t.is_hidden ? "Unhide transaction" : "Hide transaction"}
                        >
                          {t.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                        <button
                          type="button"
                          className="link destructive"
                          onClick={() => handleDeleteOne(t.id)}
                          title="Delete transaction"
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

      {/* Add Card Modal */}
      {isAddCardOpen && (
        <div className="modal-overlay" onClick={() => setIsAddCardOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">NEW CREDIT CARD</p>
            <h2>Add Card</h2>
            <form onSubmit={handleCreateCard} className="stack">
              <label>
                <span>Card Provider</span>
                <select
                  value={newCardForm.provider}
                  onChange={(e) => setNewCardForm({ ...newCardForm, provider: e.target.value })}
                >
                  <option value="rogers_bank">Rogers Bank</option>
                  <option value="scotiabank">Scotiabank</option>
                </select>
              </label>

              <label>
                <span>Card Label</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rogers Red World Elite"
                  value={newCardForm.label}
                  onChange={(e) => setNewCardForm({ ...newCardForm, label: e.target.value })}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsAddCardOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Create Card</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
