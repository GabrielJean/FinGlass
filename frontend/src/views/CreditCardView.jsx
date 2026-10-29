import React, { useEffect, useState, useRef } from "react";
import { api } from "../api";
import { formatMoney, formatDate } from "../utils/formatters";
import {
  Upload,
  Search,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  CreditCard as CreditCardIcon,
} from "lucide-react";

export function CreditCardView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [dashboard, setDashboard] = useState(null);
  const [cards, setCards] = useState([]);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);

  // Filters
  const [selectedCard, setSelectedCard] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Multi-select
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkCategory, setBulkCategory] = useState("");

  // Modals & Upload
  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const [newCardForm, setNewCardForm] = useState({ label: "", provider: "rogers_bank" });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [dashRes, cardsRes, catRes] = await Promise.all([
        api.creditCard.getDashboard(selectedCard ? `card_label=${encodeURIComponent(selectedCard)}` : ""),
        api.creditCard.getCards(),
        api.creditCard.getCategories(),
      ]);
      setDashboard(dashRes);
      setCards(Array.isArray(cardsRes) ? cardsRes : (cardsRes?.cards || []));
      setCategories(Array.isArray(catRes) ? catRes : (catRes?.categories || []));
      await loadTransactions();
    } catch (err) {
      setError(err.message || "Failed to load credit card data.");
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCard) params.set("card_label", selectedCard);
      if (selectedCategory) params.set("category", selectedCategory);
      if (includeHidden) params.set("include_hidden", "1");
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await api.creditCard.getTransactions(params.toString());
      setTransactions(Array.isArray(res) ? res : (res?.transactions || res?.rows || []));
      setSelectedIds(new Set());
    } catch (err) {
      setError(err.message || "Failed to load transactions.");
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedCard]);

  useEffect(() => {
    loadTransactions();
  }, [selectedCategory, includeHidden, searchQuery]);

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
    } catch (err) {
      setError(err.message || "Failed to update visibility.");
    }
  };

  const handleBulkHide = async (hideState) => {
    if (!selectedIds.size) return;
    try {
      await api.creditCard.hideMany(Array.from(selectedIds), hideState);
      setNotice(`${hideState ? "Hidden" : "Unhidden"} ${selectedIds.size} transactions.`);
      loadTransactions();
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
      loadData();
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
      loadData();
    } catch (err) {
      setError(err.message || "Bulk delete failed.");
    }
  };

  const handleDeleteOne = async (id) => {
    if (!window.confirm("Delete this transaction?")) return;
    try {
      await api.creditCard.deleteTransaction(id);
      setTransactions(transactions.filter((t) => t.id !== id));
      setNotice("Transaction deleted.");
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
      loadData();
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
      loadData();
    } catch (err) {
      setError(err.message || "CSV Import failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const totalSpending = Number(dashboard?.total_spending || 0);
  const totalRewards = Number(dashboard?.total_rewards || 0);
  const totalTxCount = dashboard?.transaction_count || transactions.length;

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
      <section className="panel" style={{ padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
        <div className="filter-bar" style={{ marginBottom: 0 }}>
          <div className="filter-group">
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

            <label className="checkbox-label">
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

      {/* Transactions Table */}
      <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div className="loading" style={{ minHeight: "200px" }}>Loading credit card transactions...</div>
        ) : transactions.length === 0 ? (
          <div className="empty">
            <h3>No credit card activity found</h3>
            <p>Import your Rogers Bank or Scotiabank statement CSV above.</p>
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
                  <th>Merchant / Description</th>
                  <th>Category</th>
                  <th>Card</th>
                  <th className="num">Rewards</th>
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
                        <strong>{t.merchant_name || "-"}</strong>
                        {t.is_hidden && <span className="fine" style={{ marginLeft: 6 }}>(hidden)</span>}
                      </td>
                      <td>
                        <span className="status info">{t.merchant_category || "General"}</span>
                      </td>
                      <td className="fine">{t.card_label}</td>
                      <td className="num font-bold text-positive">
                        {Number(t.rewards || 0) > 0 ? `+${formatMoney(t.rewards)}` : "-"}
                      </td>
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
            <p className="eyebrow">NEW CARD INSTRUMENT</p>
            <h2>Add Credit Card</h2>
            <form onSubmit={handleCreateCard} className="stack">
              <label>
                <span>Card Name / Label</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rogers World Elite Mastercard"
                  value={newCardForm.label}
                  onChange={(e) => setNewCardForm({ ...newCardForm, label: e.target.value })}
                />
              </label>

              <label>
                <span>Bank Provider</span>
                <select
                  value={newCardForm.provider}
                  onChange={(e) => setNewCardForm({ ...newCardForm, provider: e.target.value })}
                >
                  <option value="rogers_bank">Rogers Bank</option>
                  <option value="scotiabank">Scotiabank</option>
                </select>
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

