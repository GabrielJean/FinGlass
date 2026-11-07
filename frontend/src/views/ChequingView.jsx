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
  Wallet,
  Settings,
  Edit2,
  Check,
  X,
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

// In-memory module cache for instant view transitions
let cheqCache = {
  dashboard: null,
  transactions: null,
  accounts: null,
  categories: null,
};

export function ChequingView() {
  const [loading, setLoading] = useState(!cheqCache.dashboard);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [dashboard, setDashboard] = useState(cheqCache.dashboard);
  const [accounts, setAccounts] = useState(cheqCache.accounts || []);
  const [categories, setCategories] = useState(cheqCache.categories || []);
  const [transactions, setTransactions] = useState(cheqCache.transactions || []);
  const [txLimit, setTxLimit] = useState(100);
  const [loadingMore, setLoadingMore] = useState(false);

  // Date & Filter state
  const [quickDateRange, setQuickDateRange] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [direction, setDirection] = useState("");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Multi-select
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkCategory, setBulkCategory] = useState("");

  // Modals & Upload
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [newAccountLabel, setNewAccountLabel] = useState("");
  const [isManageAccountsOpen, setIsManageAccountsOpen] = useState(false);
  const [editingAccountLabel, setEditingAccountLabel] = useState(null);
  const [renameTargetLabel, setRenameTargetLabel] = useState("");
  const [accountActionLoading, setAccountActionLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load account and category metadata once on mount
  const loadMetadata = async () => {
    try {
      const [accRes, catRes] = await Promise.all([
        api.chequing.getAccounts(),
        api.chequing.getCategories(),
      ]);
      const accList = Array.isArray(accRes) ? accRes : (accRes?.accounts || []);
      const catList = Array.isArray(catRes) ? catRes : (catRes?.categories || []);
      setAccounts(accList);
      setCategories(catList);
      cheqCache.accounts = accList;
      cheqCache.categories = catList;
    } catch (err) {
      console.error("Failed to load metadata:", err);
    }
  };

  useEffect(() => {
    loadMetadata();
  }, []);

  // Build query string for dashboard & transactions
  const buildQueryParams = (limit = txLimit) => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    if (selectedAccount) params.set("account_label", selectedAccount);
    if (selectedCategory) params.set("category", selectedCategory);
    if (direction) params.set("direction", direction);
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (includeHidden) params.set("include_hidden", "1");
    if (limit) params.set("limit", String(limit));
    return params.toString();
  };

  // Main data fetching effect synchronized on all filter changes
  const fetchData = async () => {
    if (!dashboard) setLoading(true);
    setError("");
    try {
      const q = buildQueryParams();
      const [dashRes, txRes] = await Promise.all([
        api.chequing.getDashboard(q),
        api.chequing.getTransactions(q),
      ]);
      setDashboard(dashRes);
      const txList = Array.isArray(txRes) ? txRes : (txRes?.transactions || txRes?.rows || []);
      setTransactions(txList);
      setSelectedIds(new Set());
      cheqCache.dashboard = dashRes;
      cheqCache.transactions = txList;
    } catch (err) {
      setError(err.message || "Failed to load chequing data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate, selectedAccount, selectedCategory, direction, includeHidden, debouncedSearch]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    const nextLimit = txLimit + 100;
    setTxLimit(nextLimit);
    try {
      const q = buildQueryParams(nextLimit);
      const txRes = await api.chequing.getTransactions(q);
      const txList = Array.isArray(txRes) ? txRes : (txRes?.transactions || txRes?.rows || []);
      setTransactions(txList);
      cheqCache.transactions = txList;
    } catch (err) {
      setError("Failed to load more transactions: " + err.message);
    } finally {
      setLoadingMore(false);
    }
  };

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
    setSelectedAccount("");
    setSelectedCategory("");
    setDirection("");
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
      await api.chequing.setHidden(id, !currentHidden);
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
      await api.chequing.hideMany(Array.from(selectedIds), hideState);
      setNotice(`${hideState ? "Hidden" : "Unhidden"} ${selectedIds.size} transactions.`);
      fetchData();
    } catch (err) {
      setError(err.message || "Bulk hide failed.");
    }
  };

  const handleBulkRecategorize = async () => {
    if (!selectedIds.size || !bulkCategory) return;
    try {
      await api.chequing.recategorize(Array.from(selectedIds), bulkCategory);
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
      await api.chequing.deleteMany(Array.from(selectedIds));
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
      await api.chequing.deleteTransaction(id);
      setTransactions((prev) => (Array.isArray(prev) ? prev : []).filter((t) => t.id !== id));
      setNotice("Transaction deleted.");
      fetchData();
      loadMetadata();
    } catch (err) {
      setError(err.message || "Failed to delete transaction.");
    }
  };

  const handleCreateAccount = async (e) => {
    e.preventDefault();
    if (!newAccountLabel.trim()) return;
    try {
      await api.chequing.createAccount({ label: newAccountLabel.trim(), provider: "Wealthsimple" });
      setNotice(`Created account "${newAccountLabel}".`);
      setNewAccountLabel("");
      setIsAddAccountOpen(false);
      loadMetadata();
      fetchData();
    } catch (err) {
      setError(err.message || "Failed to create account.");
    }
  };

  const handleDeleteAccount = async (label, txCount) => {
    const count = txCount !== undefined ? txCount : 0;
    const confirmMsg = count > 0
      ? `Are you sure you want to remove the chequing account "${label}" and DELETE its ${count} transaction(s)? This action cannot be undone.`
      : `Are you sure you want to remove the chequing account "${label}"?`;
    if (!window.confirm(confirmMsg)) return;

    setAccountActionLoading(true);
    setError("");
    setNotice("");
    try {
      await api.chequing.deleteAccount(label);
      if (selectedAccount === label) {
        setSelectedAccount("");
      }
      setNotice(`Successfully removed chequing account "${label}".`);
      await Promise.all([loadMetadata(), fetchData()]);
    } catch (err) {
      setError(err.message || `Failed to delete account "${label}".`);
    } finally {
      setAccountActionLoading(false);
    }
  };

  const handleRenameAccount = async (oldLabel) => {
    const trimmed = renameTargetLabel.trim();
    if (!trimmed || trimmed === oldLabel) {
      setEditingAccountLabel(null);
      setRenameTargetLabel("");
      return;
    }

    setAccountActionLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await api.chequing.renameAccount(oldLabel, trimmed);
      const isMerge = res.merged || (Array.isArray(accounts) && accounts.some((a) => (a.label || a) === trimmed));
      if (selectedAccount === oldLabel) {
        setSelectedAccount(trimmed);
      }
      setNotice(isMerge
        ? `Merged "${oldLabel}" into "${trimmed}". All transactions reassigned.`
        : `Renamed "${oldLabel}" to "${trimmed}".`
      );
      setEditingAccountLabel(null);
      setRenameTargetLabel("");
      await Promise.all([loadMetadata(), fetchData()]);
    } catch (err) {
      setError(err.message || `Failed to rename account "${oldLabel}".`);
    } finally {
      setAccountActionLoading(false);
    }
  };

  const handleCsvUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setError("");
    const formData = new FormData();
    files.forEach((file) => formData.append("file", file));
    if (selectedAccount) formData.append("account_label", selectedAccount);

    try {
      const res = await api.chequing.importCsv(formData);
      const inserted = res.inserted_count ?? res.inserted ?? res.imported ?? res.count ?? 0;
      const skipped = res.skipped ?? 0;
      if (skipped > 0) {
        setNotice(`Imported ${inserted} transaction(s) from ${res.files || files.length} document(s) (${skipped} duplicate(s) skipped).`);
      } else {
        setNotice(`Successfully imported ${inserted} transaction(s) from ${res.files || files.length} document(s).`);
      }
      loadMetadata();
      fetchData();
    } catch (err) {
      setError(err.message || "CSV Import failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const summary = dashboard?.summary || {};
  const moneyIn = Number(summary.total_in ?? summary.money_in ?? 0);
  const moneyOut = Number(summary.total_out ?? summary.money_out ?? 0);
  const netFlow = Number(summary.net_flow ?? (moneyIn - moneyOut));
  const txCount = summary.transactions ?? summary.transaction_count ?? transactions.length;

  // Chart 1: Monthly Cash Flow (In, Out, Savings)
  const monthlyFlowChartData = useMemo(() => {
    const list = dashboard?.monthly || [];
    return {
      labels: list.map((m) => m.month),
      datasets: [
        {
          label: "Money In",
          data: list.map((m) => Number(m.in || 0)),
          backgroundColor: "rgba(52, 211, 153, 0.65)",
          borderColor: "#34d399",
          borderWidth: 1.2,
          borderRadius: 5,
        },
        {
          label: "Money Out",
          data: list.map((m) => Number(m.out || 0)),
          backgroundColor: "rgba(248, 113, 113, 0.65)",
          borderColor: "#f87171",
          borderWidth: 1.2,
          borderRadius: 5,
        },
        {
          label: "Saving Money",
          data: list.map((m) => Number(m.internal_out || 0)),
          backgroundColor: "rgba(56, 189, 248, 0.65)",
          borderColor: "#38bdf8",
          borderWidth: 1.2,
          borderRadius: 5,
        },
      ],
    };
  }, [dashboard?.monthly]);

  const monthlyFlowChartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            color: "#9bb2d1",
            font: { size: 11 },
            padding: 12,
          },
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

  // Chart 2: Category Breakdown
  const categoryChartData = useMemo(() => {
    const rawCategories = dashboard?.categories || [];
    const spendingCats = rawCategories
      .filter((c) => Number(c.total_out || 0) > 0)
      .sort((a, b) => Number(b.total_out || 0) - Number(a.total_out || 0));

    if (!spendingCats.length) return null;

    const topCats = spendingCats.slice(0, 7);
    const otherAmount = spendingCats.slice(7).reduce((sum, c) => sum + Number(c.total_out || 0), 0);

    const labels = topCats.map((c) => c.category || "Other");
    const data = topCats.map((c) => Number(c.total_out || 0));

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
    const total = (dashboard?.categories || []).reduce(
      (sum, c) => sum + Number(c.total_out || 0),
      0
    );
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

  return (
    <div>
      <div className="top-bar">
        <div>
          <p className="eyebrow">CASH & EXPENSES</p>
          <h1>Chequing & Cash Flow</h1>
          <p>Wealthsimple chequing activity, recurring savings, and transaction categories.</p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv"
            multiple
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
            {uploading ? "Importing..." : "Import Wealthsimple Activity CSV(s)"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setIsManageAccountsOpen(true)}
            title="Manage, rename, merge, or remove chequing accounts"
          >
            <Settings size={15} />
            Manage Accounts
          </button>
          <button
            type="button"
            onClick={() => setIsAddAccountOpen(true)}
          >
            <Plus size={15} />
            Add Account
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

      {/* Friendly Co-Pilot Explainer */}
      <div className="friendly-explainer">
        <div className="friendly-explainer-icon">🏦</div>
        <div>
          <h4 className="friendly-explainer-title">Understanding Your Cash Flow</h4>
          <p className="friendly-explainer-text">
            Cash flow is simple: <strong>Money Coming In</strong> (paychecks, transfers) minus <strong>Money Going Out</strong> (bills, day-to-day spending). When you have positive net flow, that surplus automatically builds your investment accounts and strengthens your financial security!
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Money In</span>
          <span className="kpi-val text-positive">
            {formatMoney(moneyIn)}
          </span>
          <span className="kpi-sub">Total credits/income</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Money Out</span>
          <span className="kpi-val text-negative">
            {formatMoney(moneyOut)}
          </span>
          <span className="kpi-sub">Total debits/spending</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Net Flow</span>
          <span className={`kpi-val ${netFlow >= 0 ? "text-positive" : "text-negative"}`}>
            {formatMoney(netFlow)}
          </span>
          <span className="kpi-sub">Period cash movement</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Transactions</span>
          <span className="kpi-val">{txCount}</span>
          <span className="kpi-sub">In selected filter</span>
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

              <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                <select
                  value={selectedAccount}
                  onChange={(e) => {
                    if (e.target.value === "__manage__") {
                      setIsManageAccountsOpen(true);
                    } else {
                      setSelectedAccount(e.target.value);
                    }
                  }}
                  style={{ minWidth: "190px" }}
                >
                  <option value="">All Chequing Accounts</option>
                  {(Array.isArray(accounts) ? accounts : []).map((a, idx) => {
                    const label = a.label || a.name || a;
                    const count = a.transactions !== undefined ? a.transactions : null;
                    return (
                      <option key={a.id || label || idx} value={label}>
                        {label} {count !== null ? `(${count})` : ""}
                      </option>
                    );
                  })}
                  <option value="__manage__">⚙️ Manage / Remove Accounts...</option>
                </select>
                <button
                  type="button"
                  className="secondary icon-only"
                  style={{ padding: "0.55rem", borderRadius: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  title="Manage, rename, merge, or remove chequing accounts"
                  onClick={() => setIsManageAccountsOpen(true)}
                >
                  <Settings size={14} />
                </button>
              </div>

              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="">All Categories</option>
                {(Array.isArray(categories) ? categories : []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="">All Directions</option>
                <option value="inflow">Inflow (Money In)</option>
                <option value="outflow">Outflow (Money Out)</option>
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
                placeholder="Search description..."
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

      {/* Collapsible Cash Flow & Spending Analytics Section */}
      <CollapsibleChartSection
        title="Cash Flow & Spending Analytics"
        subtitle="Monthly income velocity, spending outflows, internal savings, and category distribution"
        storageKey="finglass_collapse_chequing_charts"
        chartCount={2}
        icon={Wallet}
      >
        <div className="chart-grid">
          <ChartCard
            title="Monthly Cash Flow"
            subtitle="Money in, money out, and transfers to savings"
            height={260}
            empty={!monthlyFlowChartData.labels.length}
            emptyMessage="No monthly cash flow data available for the active filters."
          >
            {monthlyFlowChartData.labels.length > 0 && (
              <Bar data={monthlyFlowChartData} options={monthlyFlowChartOptions} />
            )}
          </ChartCard>

          <ChartCard
            title="Outflow by Category"
            subtitle="Expenses distributed by category tag"
            height={260}
            empty={!categoryChartData}
            emptyMessage="No categorized expenses available."
          >
            {categoryChartData && (
              <Doughnut data={categoryChartData} options={categoryChartOptions} />
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
            <h3>No chequing transactions</h3>
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
                  <th>Description</th>
                  <th>Category</th>
                  <th>Account</th>
                  <th className="num">Amount</th>
                  <th style={{ textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(transactions) ? transactions : []).map((t) => {
                  const amt = Number(t.amount || 0);
                  const isCredit = amt >= 0;
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
                        <strong>{t.description || t.memo || "-"}</strong>
                        {t.is_hidden && <span className="fine" style={{ marginLeft: 6 }}>(hidden)</span>}
                      </td>
                      <td>
                        <span className="status info">{t.category || "Uncategorized"}</span>
                      </td>
                      <td>{t.account_label || "Chequing"}</td>
                      <td className={`num font-bold ${isCredit ? "text-positive" : "text-negative"}`}>
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

        {transactions.length > 0 && transactions.length < txCount && (
          <div style={{ padding: "0.85rem 1.25rem", textAlign: "center", borderTop: "1px solid var(--border-dim)" }}>
            <button
              type="button"
              className="secondary"
              disabled={loadingMore}
              onClick={handleLoadMore}
              style={{ padding: "0.5rem 1.25rem", fontSize: "0.84rem" }}
            >
              {loadingMore ? "Loading more..." : `Load More Transactions (${transactions.length} of ${txCount})`}
            </button>
          </div>
        )}
      </section>

      {/* Add Account Modal */}
      {isAddAccountOpen && (
        <div className="modal-overlay" onClick={() => setIsAddAccountOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">NEW CHEQUING ACCOUNT</p>
            <h2>Add Account</h2>
            <form onSubmit={handleCreateAccount} className="stack">
              <label>
                <span>Account Label</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Wealthsimple Chequing"
                  value={newAccountLabel}
                  onChange={(e) => setNewAccountLabel(e.target.value)}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsAddAccountOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Create Account</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Accounts Modal */}
      {isManageAccountsOpen && (
        <div className="modal-overlay" onClick={() => { setIsManageAccountsOpen(false); setEditingAccountLabel(null); }}>
          <div className="modal-dialog" style={{ maxWidth: "560px", width: "95%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
              <p className="eyebrow" style={{ margin: 0 }}>CHEQUING ACCOUNTS</p>
              <button
                type="button"
                className="link"
                style={{ padding: "0.2rem", color: "var(--text-quiet)" }}
                onClick={() => { setIsManageAccountsOpen(false); setEditingAccountLabel(null); }}
              >
                <X size={18} />
              </button>
            </div>
            <h2>Manage Chequing Accounts</h2>
            <p className="fine" style={{ marginBottom: "1.25rem" }}>
              Rename, merge, or delete your chequing accounts. Deleting an account removes its label and all associated cash flow transactions.
            </p>

            <div className="stack" style={{ gap: "0.75rem", marginBottom: "1.5rem", maxHeight: "360px", overflowY: "auto" }}>
              {(Array.isArray(accounts) && accounts.length > 0) ? (
                accounts.map((acc) => {
                  const label = acc.label || acc.name || acc;
                  const txCount = acc.transactions !== undefined ? acc.transactions : 0;
                  const isEditing = editingAccountLabel === label;

                  return (
                    <div
                      key={label}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0.85rem 1rem",
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-panel)",
                        borderRadius: "8px",
                        gap: "0.75rem",
                      }}
                    >
                      {isEditing ? (
                        <div style={{ display: "flex", gap: "0.5rem", flex: 1, alignItems: "center", flexWrap: "wrap" }}>
                          <input
                            type="text"
                            value={renameTargetLabel}
                            onChange={(e) => setRenameTargetLabel(e.target.value)}
                            placeholder="New name or existing account to merge"
                            style={{ flex: 1, minWidth: "180px", padding: "0.45rem 0.65rem", fontSize: "0.88rem" }}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRenameAccount(label);
                              if (e.key === "Escape") setEditingAccountLabel(null);
                            }}
                          />
                          <button
                            type="button"
                            disabled={accountActionLoading || !renameTargetLabel.trim()}
                            onClick={() => handleRenameAccount(label)}
                            style={{ padding: "0.45rem 0.75rem", fontSize: "0.82rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                          >
                            <Check size={14} /> Save
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setEditingAccountLabel(null)}
                            style={{ padding: "0.45rem 0.75rem", fontSize: "0.82rem" }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{label}</div>
                            <span className="fine" style={{ fontSize: "0.78rem", color: "var(--text-quiet)" }}>
                              {txCount} transaction{txCount === 1 ? "" : "s"}
                            </span>
                          </div>

                          <div style={{ display: "flex", gap: "0.4rem" }}>
                            <button
                              type="button"
                              className="secondary"
                              style={{ padding: "0.35rem 0.65rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                              onClick={() => {
                                setEditingAccountLabel(label);
                                setRenameTargetLabel(label);
                              }}
                              title="Rename or merge into another account"
                            >
                              <Edit2 size={13} /> Rename / Merge
                            </button>
                            <button
                              type="button"
                              className="destructive"
                              style={{ padding: "0.35rem 0.65rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                              disabled={accountActionLoading}
                              onClick={() => handleDeleteAccount(label, txCount)}
                              title="Delete account and all its transactions"
                            >
                              <Trash2 size={13} /> Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="fine" style={{ fontStyle: "italic" }}>No chequing accounts found.</p>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-panel)", paddingTop: "1rem" }}>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setIsManageAccountsOpen(false);
                  setIsAddAccountOpen(true);
                }}
              >
                <Plus size={14} /> Add New Account
              </button>
              <button
                type="button"
                onClick={() => { setIsManageAccountsOpen(false); setEditingAccountLabel(null); }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
