import React, { useEffect, useState } from "react";
import { api } from "../api";
import { formatMoney, formatPercent, formatDate } from "../utils/formatters";
import {
  TrendingUp,
  Plus,
  Trash2,
  Edit2,
  Search,
  ArrowLeft,
  Calendar,
  Layers,
} from "lucide-react";

export function AcbView({ initialSymbol = null }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [securities, setSecurities] = useState([]);
  const [transactionTypes, setTransactionTypes] = useState([]);
  const [selectedSecurity, setSelectedSecurity] = useState(initialSymbol);
  const [ledgerRows, setLedgerRows] = useState([]);
  const [ledgerSummary, setLedgerSummary] = useState(null);

  // Modal
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState(null);
  const [txForm, setTxForm] = useState({
    security: "",
    trade_date: new Date().toISOString().split("T")[0],
    transaction_type: "Buy",
    shares: "",
    amount: "",
    commission: "0",
    memo: "",
  });

  const loadSecurities = async () => {
    setLoading(true);
    setError("");
    try {
      const [secRes, typesRes] = await Promise.all([
        api.acb.getSecurities(),
        api.acb.getTransactionTypes(),
      ]);
      setSecurities(Array.isArray(secRes) ? secRes : (secRes?.securities || []));
      setTransactionTypes(Array.isArray(typesRes) ? typesRes : (typesRes?.transaction_types || []));
      if (selectedSecurity) {
        await loadLedger(selectedSecurity);
      }
    } catch (err) {
      setError(err.message || "Failed to load ACB data.");
    } finally {
      setLoading(false);
    }
  };

  const loadLedger = async (symbol) => {
    try {
      const res = await api.acb.getLedger(symbol);
      const rows = Array.isArray(res) ? res : (res.rows || []);
      setLedgerRows(rows);
      if (rows.length > 0) {
        const last = rows[rows.length - 1];
        const totalGains = rows.reduce((sum, r) => sum + Number(r.capital_gain || 0), 0);
        const lastShares = Number(last.running_shares || 0);
        const lastAcb = Number(last.running_acb || 0);
        setLedgerSummary({
          shares: lastShares,
          acb: lastAcb,
          acb_per_share: lastShares > 0 ? lastAcb / lastShares : 0,
          capital_gain: totalGains,
        });
      } else {
        setLedgerSummary(null);
      }
    } catch (err) {
      setError(err.message || "Failed to load ledger for " + symbol);
    }
  };

  useEffect(() => {
    loadSecurities();
  }, []);

  const handleSelectSecurity = async (sym) => {
    setSelectedSecurity(sym);
    if (sym) {
      await loadLedger(sym);
    } else {
      setLedgerRows([]);
      setLedgerSummary(null);
    }
  };

  const handleSaveTransaction = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        security: txForm.security.trim().toUpperCase(),
        trade_date: txForm.trade_date,
        transaction_type: txForm.transaction_type,
        shares: Number(txForm.shares || 0),
        amount: Number(txForm.amount || 0),
        commission: Number(txForm.commission || 0),
        memo: txForm.memo,
      };

      if (editingTx) {
        await api.acb.updateTransaction(editingTx.id, payload);
        setNotice(`Updated transaction for ${payload.security}.`);
      } else {
        await api.acb.createTransaction(payload);
        setNotice(`Added transaction for ${payload.security}.`);
      }

      setIsTxModalOpen(false);
      setEditingTx(null);
      loadSecurities();
      if (selectedSecurity) loadLedger(selectedSecurity);
    } catch (err) {
      setError(err.message || "Failed to save transaction.");
    }
  };

  const handleDeleteTx = async (id) => {
    if (!window.confirm("Delete this transaction?")) return;
    try {
      await api.acb.deleteTransaction(id);
      setNotice("Transaction deleted.");
      if (selectedSecurity) loadLedger(selectedSecurity);
      loadSecurities();
    } catch (err) {
      setError(err.message || "Failed to delete transaction.");
    }
  };

  const openAddModal = (defaultSymbol = "") => {
    setEditingTx(null);
    setTxForm({
      security: defaultSymbol || selectedSecurity || "",
      trade_date: new Date().toISOString().split("T")[0],
      transaction_type: "Buy",
      shares: "",
      amount: "",
      commission: "0",
      memo: "",
    });
    setIsTxModalOpen(true);
  };

  return (
    <div>
      <div className="top-bar">
        <div>
          <p className="eyebrow">CRA ADJUSTED COST BASE (ACB)</p>
          <h1>ACB & Capital Gains Tracker</h1>
          <p>
            Track tax basis, return of capital, and realized capital gains for Canadian non-registered portfolios.
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          {selectedSecurity && (
            <button
              type="button"
              className="secondary"
              onClick={() => handleSelectSecurity(null)}
            >
              <ArrowLeft size={15} />
              All Securities
            </button>
          )}
          <button
            type="button"
            onClick={() => openAddModal(selectedSecurity)}
          >
            <Plus size={15} />
            Record Trade
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

      {/* Main View: Security List vs Security Ledger Drill-down */}
      {!selectedSecurity ? (
        <>
          <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="panel-header" style={{ padding: "1.25rem 1.5rem 0.75rem" }}>
              <h3>Tracked Securities</h3>
              <span className="fine">{securities.length} securities with cost-basis history</span>
            </div>

            {loading ? (
              <div className="loading" style={{ minHeight: "200px" }}>Loading securities...</div>
            ) : securities.length === 0 ? (
              <div className="empty">
                <h3>No ACB transactions yet</h3>
                <p>Record a trade above or import your brokerage activities CSV to calculate cost basis.</p>
              </div>
            ) : (
              <div className="table-wrap" style={{ border: "none" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th className="num">Transactions</th>
                      <th className="num">Current Shares</th>
                      <th className="num">Total ACB</th>
                      <th className="num">ACB Per Share</th>
                      <th className="num">Realized Gain/Loss</th>
                      <th style={{ textAlign: "center" }}>Ledger</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(securities) ? securities : []).map((s) => {
                      const realized = Number(s.realized_gain || s.capital_gain || 0);
                      const shares = Number(s.shares || s.quantity || 0);
                      const acb = Number(s.acb || s.total_acb || 0);
                      const acbPerShare = shares > 0 ? acb / shares : 0;

                      return (
                        <tr key={s.security}>
                          <td>
                            <strong className="mono" style={{ fontSize: "1rem", color: "var(--accent)" }}>
                              {s.security}
                            </strong>
                          </td>
                          <td className="num">{s.transaction_count || s.count || "-"}</td>
                          <td className="num">{shares.toFixed(4)}</td>
                          <td className="num font-bold">{formatMoney(acb)}</td>
                          <td className="num">${acbPerShare.toFixed(4)}</td>
                          <td className={`num font-bold ${realized >= 0 ? "text-positive" : "text-negative"}`}>
                            {formatMoney(realized)}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <button
                              type="button"
                              className="secondary"
                              style={{ padding: "0.35rem 0.75rem", fontSize: "0.82rem" }}
                              onClick={() => handleSelectSecurity(s.security)}
                            >
                              View Ledger &rarr;
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
        </>
      ) : (
        /* Detailed Security Ledger */
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
            <span className="status positive" style={{ fontSize: "1rem", padding: "0.4rem 0.8rem" }}>
              {selectedSecurity}
            </span>
            <span className="fine">CRA Chronological Ledger & Running Cost Basis</span>
          </div>

          {ledgerSummary && (
            <section className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-label">Current Shares</span>
                <span className="kpi-val">{Number(ledgerSummary.shares || 0).toFixed(4)}</span>
                <span className="kpi-sub">Total active position</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Running ACB</span>
                <span className="kpi-val">{formatMoney(ledgerSummary.acb || 0)}</span>
                <span className="kpi-sub">
                  Per share: <strong className="num">${Number(ledgerSummary.acb_per_share || 0).toFixed(4)}</strong>
                </span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Realized Capital Gain</span>
                <span className={`kpi-val ${Number(ledgerSummary.capital_gain || 0) >= 0 ? "text-positive" : "text-negative"}`}>
                  {formatMoney(ledgerSummary.capital_gain || 0)}
                </span>
                <span className="kpi-sub">Reportable on Schedule 3</span>
              </div>
            </section>
          )}

          <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="table-wrap" style={{ border: "none" }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th className="num">Shares</th>
                    <th className="num">Price/Share</th>
                    <th className="num">Commission</th>
                    <th className="num">Total Amount</th>
                    <th className="num">Running Shares</th>
                    <th className="num">Running ACB</th>
                    <th className="num">Realized Gain</th>
                    <th style={{ textAlign: "center" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(ledgerRows) ? ledgerRows : []).map((r, idx) => {
                    const gain = Number(r.capital_gain || 0);

                    return (
                      <tr key={r.id || idx}>
                        <td className="mono">{formatDate(r.trade_date)}</td>
                        <td>
                          <span className={`status ${r.transaction_type === "Buy" ? "positive" : r.transaction_type === "Sell" ? "negative" : "info"}`}>
                            {r.transaction_type}
                          </span>
                        </td>
                        <td className="num">{Number(r.shares || 0).toFixed(4)}</td>
                        <td className="num">${Number(r.amount_per_share || 0).toFixed(4)}</td>
                        <td className="num">{Number(r.commission || 0) > 0 ? formatMoney(r.commission) : "-"}</td>
                        <td className="num font-bold">{formatMoney(r.amount)}</td>
                        <td className="num mono">{Number(r.running_shares || 0).toFixed(4)}</td>
                        <td className="num mono font-bold">{formatMoney(r.running_acb || 0)}</td>
                        <td className={`num font-bold ${gain > 0 ? "text-positive" : gain < 0 ? "text-negative" : ""}`}>
                          {gain !== 0 ? formatMoney(gain) : "-"}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {r.id && (
                            <button
                              type="button"
                              className="link destructive"
                              onClick={() => handleDeleteTx(r.id)}
                              title="Delete trade"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* Record Trade Modal */}
      {isTxModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTxModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">TRADE RECORD</p>
            <h2>Add Trade Transaction</h2>
            <form onSubmit={handleSaveTransaction} className="stack">
              <div className="form-grid-2">
                <label>
                  <span>Security Ticker</span>
                  <input
                    type="text"
                    required
                    placeholder="e.g. VFV.TO"
                    value={txForm.security}
                    onChange={(e) => setTxForm({ ...txForm, security: e.target.value.toUpperCase() })}
                  />
                </label>

                <label>
                  <span>Transaction Type</span>
                  <select
                    value={txForm.transaction_type}
                    onChange={(e) => setTxForm({ ...txForm, transaction_type: e.target.value })}
                  >
                    {(Array.isArray(transactionTypes) && transactionTypes.length > 0) ? (
                      transactionTypes.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))
                    ) : (
                      <>
                        <option value="Buy">Buy</option>
                        <option value="Sell">Sell</option>
                        <option value="Return of Capital">Return of Capital</option>
                        <option value="Capital Gains Dividend">Capital Gains Dividend</option>
                        <option value="Reinvested Dividend">Reinvested Dividend</option>
                        <option value="Split">Split</option>
                      </>
                    )}
                  </select>
                </label>
              </div>

              <div className="form-grid-2">
                <label>
                  <span>Shares</span>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="e.g. 50"
                    value={txForm.shares}
                    onChange={(e) => setTxForm({ ...txForm, shares: e.target.value })}
                  />
                </label>

                <label>
                  <span>Total Amount (CAD)</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={txForm.amount}
                    onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })}
                  />
                </label>
              </div>

              <div className="form-grid-2">
                <label>
                  <span>Commission / Trading Fee</span>
                  <input
                    type="number"
                    step="0.01"
                    value={txForm.commission}
                    onChange={(e) => setTxForm({ ...txForm, commission: e.target.value })}
                  />
                </label>

                <label>
                  <span>Trade Date</span>
                  <input
                    type="date"
                    required
                    value={txForm.trade_date}
                    onChange={(e) => setTxForm({ ...txForm, trade_date: e.target.value })}
                  />
                </label>
              </div>

              <label>
                <span>Memo / Notes</span>
                <input
                  type="text"
                  placeholder="e.g. Questrade regular purchase"
                  value={txForm.memo}
                  onChange={(e) => setTxForm({ ...txForm, memo: e.target.value })}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsTxModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Save Trade</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
