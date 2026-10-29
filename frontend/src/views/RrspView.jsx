import React, { useEffect, useState, useRef } from "react";
import { api } from "../api";
import { formatMoney, formatDate } from "../utils/formatters";
import {
  Upload,
  Plus,
  Trash2,
  Settings,
  ArrowRightLeft,
  AlertCircle,
} from "lucide-react";

export function RrspView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [limits, setLimits] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [openingBalance, setOpeningBalance] = useState(null);

  // Modals
  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const [roomForm, setRoomForm] = useState({ amount: "", base_year: 2024 });

  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [depositForm, setDepositForm] = useState({
    account_id: "",
    contribution_date: new Date().toISOString().split("T")[0],
    amount: "",
    contribution_type: "Deposit",
    is_unused: false,
    deducted_tax_year: "",
    memo: "",
  });

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({
    from_account_id: "",
    to_account_id: "",
    transfer_date: new Date().toISOString().split("T")[0],
    amount: "",
    memo: "",
  });

  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [newAccountForm, setNewAccountForm] = useState({
    account_name: "",
    account_number: "",
    opening_balance: 0,
  });

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [sumRes, accRes, limitsRes, txRes, openRes] = await Promise.all([
        api.rrsp.getSummary(),
        api.rrsp.getAccounts(),
        api.rrsp.getAnnualLimits(),
        api.rrsp.getTransactions(),
        api.rrsp.getOpeningBalance(),
      ]);
      setSummary(sumRes);
      setAccounts(Array.isArray(accRes) ? accRes : (accRes?.accounts || []));
      setLimits(Array.isArray(limitsRes) ? limitsRes : (limitsRes?.limits || []));
      setTransactions(Array.isArray(txRes) ? txRes : (txRes?.transactions || txRes?.rows || []));
      setOpeningBalance(openRes);
      if (openRes) {
        setRoomForm({
          amount: openRes.opening_balance || "",
          base_year: openRes.base_year || 2024,
        });
      }
    } catch (err) {
      setError(err.message || "Failed to load RRSP data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveRoom = async (e) => {
    e.preventDefault();
    try {
      await api.rrsp.setOpeningBalance(Number(roomForm.amount), Number(roomForm.base_year));
      setNotice("RRSP deduction room configured.");
      setIsRoomModalOpen(false);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to update RRSP room.");
    }
  };

  const handleSaveDeposit = async (e) => {
    e.preventDefault();
    try {
      await api.rrsp.createContribution({
        rrsp_account_id: Number(depositForm.account_id),
        contribution_date: depositForm.contribution_date,
        amount: Number(depositForm.amount),
        contribution_type: depositForm.contribution_type,
        is_unused: depositForm.is_unused,
        deducted_tax_year: depositForm.deducted_tax_year ? Number(depositForm.deducted_tax_year) : null,
        memo: depositForm.memo,
      });
      setNotice("RRSP contribution recorded.");
      setIsDepositModalOpen(false);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to record contribution.");
    }
  };

  const handleSaveTransfer = async (e) => {
    e.preventDefault();
    try {
      await api.rrsp.createTransfer({
        from_account_id: Number(transferForm.from_account_id),
        to_account_id: Number(transferForm.to_account_id),
        transfer_date: transferForm.transfer_date,
        amount: Number(transferForm.amount),
        memo: transferForm.memo,
      });
      setNotice("RRSP transfer recorded.");
      setIsTransferModalOpen(false);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to record transfer.");
    }
  };

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    try {
      await api.rrsp.createAccount(newAccountForm);
      setNotice(`Created account ${newAccountForm.account_name}.`);
      setIsAccountModalOpen(false);
      setNewAccountForm({ account_name: "", account_number: "", opening_balance: 0 });
      loadData();
    } catch (err) {
      setError(err.message || "Failed to create account.");
    }
  };

  const handleDeleteTx = async (id) => {
    if (!window.confirm("Delete this RRSP record?")) return;
    try {
      await api.rrsp.deleteTransaction(id);
      setNotice("Record deleted.");
      loadData();
    } catch (err) {
      setError(err.message || "Failed to delete.");
    }
  };

  const handleReset = async () => {
    if (!window.confirm("WARNING: This will reset all RRSP contributions and limit history. Continue?")) return;
    try {
      await api.rrsp.reset();
      setNotice("RRSP records reset.");
      loadData();
    } catch (err) {
      setError(err.message || "Reset failed.");
    }
  };

  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await api.rrsp.importCsv(formData);
      setNotice(`Successfully imported ${res.imported_count || res.count || "RRSP"} transactions.`);
      loadData();
    } catch (err) {
      setError(err.message || "CSV Import failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const isRoomConfigured = openingBalance?.configured || summary?.configured;

  return (
    <div>
      <div className="top-bar">
        <div>
          <p className="eyebrow">CRA RETIREMENT SAVINGS</p>
          <h1>Registered Retirement Savings Plan (RRSP)</h1>
          <p>Deduction limits, carried-forward unused contributions, and tax deduction tracking.</p>
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
            {uploading ? "Importing..." : "Import RRSP CSV"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setIsRoomModalOpen(true)}
          >
            <Settings size={15} />
            Set Deduction Limit
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setIsTransferModalOpen(true)}
            disabled={accounts.length < 2}
          >
            <ArrowRightLeft size={15} />
            Transfer
          </button>
          <button
            type="button"
            onClick={() => {
              if (accounts.length > 0) {
                setDepositForm({ ...depositForm, account_id: accounts[0].id });
              }
              setIsDepositModalOpen(true);
            }}
          >
            <Plus size={15} />
            Add Contribution
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

      {!loading && !isRoomConfigured && (
        <div className="notice" style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <AlertCircle size={20} color="#91b6ff" />
            <span>
              Your baseline RRSP deduction limit has not been set. Provide your available room from your CRA Notice of Assessment.
            </span>
          </div>
          <button type="button" onClick={() => setIsRoomModalOpen(true)}>
            Set Limit Now
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Remaining Deduction Room</span>
          <span className="kpi-val" style={{ color: "#91b6ff" }}>
            {formatMoney(summary?.current_year_room || 0)}
          </span>
          <span className="kpi-sub">Available for tax deduction</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Current Year Contributions</span>
          <span className="kpi-val text-positive">
            {formatMoney(summary?.current_year_contributions || 0)}
          </span>
          <span className="kpi-sub">Deposits made this year</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Unused Contributions</span>
          <span className="kpi-val" style={{ color: "#ffd391" }}>
            {formatMoney(summary?.unused_contributions || 0)}
          </span>
          <span className="kpi-sub">Contributed but not yet deducted</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">RRSP Accounts</span>
          <span className="kpi-val">{accounts.length}</span>
          <span className="kpi-sub">
            <button type="button" className="link" onClick={() => setIsAccountModalOpen(true)} style={{ padding: 0 }}>
              + Add institution
            </button>
          </span>
        </div>
      </section>

      {/* Transactions Ledger */}
      <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div className="panel-header" style={{ padding: "1.25rem 1.5rem 0.75rem" }}>
          <h3>RRSP Contributions & Transfers Ledger</h3>
          <button type="button" className="link destructive" onClick={handleReset}>
            Reset RRSP
          </button>
        </div>

        {loading ? (
          <div className="loading" style={{ minHeight: "200px" }}>Loading records...</div>
        ) : transactions.length === 0 ? (
          <div className="empty">
            <h3>No RRSP activity recorded</h3>
            <p>Record your contributions or import your CSV statement to calculate tax deduction room.</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: "none" }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th>Unused / Deducted</th>
                  <th>Memo</th>
                  <th className="num">Amount</th>
                  <th style={{ textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(transactions) ? transactions : []).map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{formatDate(t.contribution_date)}</td>
                    <td><strong>{t.account_name || "RRSP"}</strong></td>
                    <td>
                      <span className="status info">
                        {t.contribution_type.replace("_", " ")}
                      </span>
                    </td>
                    <td>
                      {t.is_unused ? (
                        <span className="status warning">Unused</span>
                      ) : t.deducted_tax_year ? (
                        <span className="status positive">Deducted {t.deducted_tax_year}</span>
                      ) : (
                        <span className="fine">Standard</span>
                      )}
                    </td>
                    <td className="fine">{t.memo || "-"}</td>
                    <td className="num font-bold text-positive">
                      {formatMoney(t.amount)}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        className="link destructive"
                        onClick={() => handleDeleteTx(t.id)}
                        title="Delete record"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Baseline Room Modal */}
      {isRoomModalOpen && (
        <div className="modal-overlay" onClick={() => setIsRoomModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">CRA DEDUCTION LIMIT SETUP</p>
            <h2>Configure RRSP Deduction Room</h2>
            <form onSubmit={handleSaveRoom} className="stack">
              <label>
                Base Tax Year
                <input
                  type="number"
                  required
                  min="2000"
                  max="2035"
                  value={roomForm.base_year}
                  onChange={(e) => setRoomForm({ ...roomForm, base_year: e.target.value })}
                />
              </label>

              <label>
                Available Deduction Limit (CAD)
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 25000"
                  value={roomForm.amount}
                  onChange={(e) => setRoomForm({ ...roomForm, amount: e.target.value })}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsRoomModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Save Limit</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Contribution Modal */}
      {isDepositModalOpen && (
        <div className="modal-overlay" onClick={() => setIsDepositModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">RECORD CONTRIBUTION</p>
            <h2>Add RRSP Contribution</h2>
            <form onSubmit={handleSaveDeposit} className="stack">
              <label>
                <span>Account</span>
                <select
                  required
                  value={depositForm.account_id}
                  onChange={(e) => setDepositForm({ ...depositForm, account_id: e.target.value })}
                >
                  <option value="">Select account...</option>
                  {(Array.isArray(accounts) ? accounts : []).map((a) => (
                    <option key={a.id} value={a.id}>{a.account_name}</option>
                  ))}
                </select>
              </label>

              <div className="form-grid-2">
                <label>
                  <span>Amount (CAD)</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={depositForm.amount}
                    onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                  />
                </label>

                <label>
                  <span>Contribution Date</span>
                  <input
                    type="date"
                    required
                    value={depositForm.contribution_date}
                    onChange={(e) => setDepositForm({ ...depositForm, contribution_date: e.target.value })}
                  />
                </label>
              </div>

              <div className="form-grid-2">
                <label className="checkbox-label" style={{ marginTop: "1.5rem" }}>
                  <input
                    type="checkbox"
                    checked={depositForm.is_unused}
                    onChange={(e) => setDepositForm({ ...depositForm, is_unused: e.target.checked })}
                  />
                  Mark as Unused Contribution
                </label>

                <label>
                  <span>Deducted in Tax Year (optional)</span>
                  <input
                    type="number"
                    placeholder="e.g. 2024"
                    value={depositForm.deducted_tax_year}
                    onChange={(e) => setDepositForm({ ...depositForm, deducted_tax_year: e.target.value })}
                  />
                </label>
              </div>

              <label>
                <span>Memo / Note</span>
                <input
                  type="text"
                  placeholder="e.g. Employer matching plan"
                  value={depositForm.memo}
                  onChange={(e) => setDepositForm({ ...depositForm, memo: e.target.value })}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsDepositModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Record Contribution</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Transfer Modal */}
      {isTransferModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTransferModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">INSTITUTION TRANSFER</p>
            <h2>Direct RRSP-to-RRSP Transfer</h2>
            <form onSubmit={handleSaveTransfer} className="stack">
              <div className="form-grid-2">
                <label>
                  <span>From Account</span>
                  <select
                    required
                    value={transferForm.from_account_id}
                    onChange={(e) => setTransferForm({ ...transferForm, from_account_id: e.target.value })}
                  >
                    <option value="">Select source account...</option>
                    {(Array.isArray(accounts) ? accounts : []).map((a) => (
                      <option key={a.id} value={a.id}>{a.account_name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>To Account</span>
                  <select
                    required
                    value={transferForm.to_account_id}
                    onChange={(e) => setTransferForm({ ...transferForm, to_account_id: e.target.value })}
                  >
                    <option value="">Select destination account...</option>
                    {(Array.isArray(accounts) ? accounts : []).filter((a) => String(a.id) !== String(transferForm.from_account_id)).map((a) => (
                      <option key={a.id} value={a.id}>{a.account_name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="form-grid-2">
                <label>
                  <span>Amount (CAD)</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={transferForm.amount}
                    onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                  />
                </label>

                <label>
                  <span>Transfer Date</span>
                  <input
                    type="date"
                    required
                    value={transferForm.transfer_date}
                    onChange={(e) => setTransferForm({ ...transferForm, transfer_date: e.target.value })}
                  />
                </label>
              </div>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsTransferModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Record Transfer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Account Modal */}
      {isAccountModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAccountModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">NEW RRSP ACCOUNT</p>
            <h2>Add RRSP Account</h2>
            <form onSubmit={handleSaveAccount} className="stack">
              <label>
                <span>Account Name</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Questrade RRSP"
                  value={newAccountForm.account_name}
                  onChange={(e) => setNewAccountForm({ ...newAccountForm, account_name: e.target.value })}
                />
              </label>

              <label>
                <span>Account Number (optional)</span>
                <input
                  type="text"
                  placeholder="e.g. RRSP-12345"
                  value={newAccountForm.account_number}
                  onChange={(e) => setNewAccountForm({ ...newAccountForm, account_number: e.target.value })}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsAccountModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Create Account</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
