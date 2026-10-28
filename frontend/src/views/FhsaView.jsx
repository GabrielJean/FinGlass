import React, { useEffect, useState, useRef } from "react";
import { api } from "../api";
import { formatMoney, formatDate } from "../utils/formatters";
import {
  Upload,
  Plus,
  Trash2,
  Settings,
  ArrowRightLeft,
  Home,
  AlertCircle,
} from "lucide-react";

export function FhsaView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
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
    is_qualifying_withdrawal: false,
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
      const [sumRes, accRes, txRes, openRes] = await Promise.all([
        api.fhsa.getSummary(),
        api.fhsa.getAccounts(),
        api.fhsa.getTransactions(),
        api.fhsa.getOpeningBalance(),
      ]);
      setSummary(sumRes);
      setAccounts(Array.isArray(accRes) ? accRes : (accRes?.accounts || []));
      setTransactions(Array.isArray(txRes) ? txRes : (txRes?.transactions || txRes?.rows || []));
      setOpeningBalance(openRes);
      if (openRes) {
        setRoomForm({
          amount: openRes.opening_balance || "",
          base_year: openRes.base_year || 2024,
        });
      }
    } catch (err) {
      setError(err.message || "Failed to load FHSA data.");
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
      await api.fhsa.setOpeningBalance(Number(roomForm.amount), Number(roomForm.base_year));
      setNotice("FHSA baseline room configured.");
      setIsRoomModalOpen(false);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to update FHSA room.");
    }
  };

  const handleSaveDeposit = async (e) => {
    e.preventDefault();
    try {
      await api.fhsa.createContribution({
        fhsa_account_id: Number(depositForm.account_id),
        contribution_date: depositForm.contribution_date,
        amount: Number(depositForm.amount),
        contribution_type: depositForm.contribution_type,
        is_qualifying_withdrawal: depositForm.is_qualifying_withdrawal,
        memo: depositForm.memo,
      });
      setNotice("FHSA transaction recorded.");
      setIsDepositModalOpen(false);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to record transaction.");
    }
  };

  const handleSaveTransfer = async (e) => {
    e.preventDefault();
    try {
      await api.fhsa.createTransfer({
        from_account_id: Number(transferForm.from_account_id),
        to_account_id: Number(transferForm.to_account_id),
        transfer_date: transferForm.transfer_date,
        amount: Number(transferForm.amount),
        memo: transferForm.memo,
      });
      setNotice("FHSA transfer recorded.");
      setIsTransferModalOpen(false);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to record transfer.");
    }
  };

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    try {
      await api.fhsa.createAccount(newAccountForm);
      setNotice(`Created account ${newAccountForm.account_name}.`);
      setIsAccountModalOpen(false);
      setNewAccountForm({ account_name: "", account_number: "", opening_balance: 0 });
      loadData();
    } catch (err) {
      setError(err.message || "Failed to create account.");
    }
  };

  const handleDeleteTx = async (id) => {
    if (!window.confirm("Delete this FHSA record?")) return;
    try {
      await api.fhsa.deleteTransaction(id);
      setNotice("Record deleted.");
      loadData();
    } catch (err) {
      setError(err.message || "Failed to delete.");
    }
  };

  const handleReset = async () => {
    if (!window.confirm("WARNING: This will reset all FHSA records. Continue?")) return;
    try {
      await api.fhsa.reset();
      setNotice("FHSA records reset.");
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
      const res = await api.fhsa.importCsv(formData);
      setNotice(`Successfully imported ${res.imported_count || res.count || "FHSA"} transactions.`);
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
          <p className="eyebrow">FIRST-TIME HOME BUYER SHELTER</p>
          <h1>First Home Savings Account (FHSA)</h1>
          <p>Lifetime $40,000 cap, annual $8,000 limit, and tax-free qualifying home purchase withdrawals.</p>
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
            {uploading ? "Importing..." : "Import FHSA CSV"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setIsRoomModalOpen(true)}
          >
            <Settings size={15} />
            Set Opening Room
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
            Add Transaction
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

      {!isRoomConfigured && (
        <div className="notice" style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <AlertCircle size={20} color="#ffd391" />
            <span>
              Your baseline FHSA room has not been established yet. Set your opening room to start tracking your $40,000 lifetime room.
            </span>
          </div>
          <button type="button" onClick={() => setIsRoomModalOpen(true)}>
            Set Room Now
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Current Year Room</span>
          <span className="kpi-val" style={{ color: "#ffd391" }}>
            {formatMoney(summary?.current_year_room || 0)}
          </span>
          <span className="kpi-sub">Available contribution room for this year</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Lifetime Room Remaining</span>
          <span className="kpi-val text-positive">
            {formatMoney(summary?.lifetime_room_remaining || 40000)}
          </span>
          <span className="kpi-sub">Out of $40,000 lifetime maximum</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Qualifying Withdrawals</span>
          <span className="kpi-val">
            {formatMoney(summary?.total_qualifying_withdrawals || 0)}
          </span>
          <span className="kpi-sub">Tax-free home purchases</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">FHSA Accounts</span>
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
          <h3>FHSA Ledger</h3>
          <button type="button" className="link destructive" onClick={handleReset}>
            Reset FHSA
          </button>
        </div>

        {loading ? (
          <div className="loading" style={{ minHeight: "200px" }}>Loading records...</div>
        ) : transactions.length === 0 ? (
          <div className="empty">
            <h3>No FHSA transactions recorded</h3>
            <p>Add your FHSA deposits or import your statement CSV to track your first home savings.</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: "none" }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th>Home Qualifying</th>
                  <th>Memo</th>
                  <th className="num">Amount</th>
                  <th style={{ textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(transactions) ? transactions : []).map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{formatDate(t.contribution_date)}</td>
                    <td><strong>{t.account_name || "FHSA"}</strong></td>
                    <td>
                      <span className="status info">
                        {t.contribution_type.replace("_", " ")}
                      </span>
                    </td>
                    <td>
                      {t.is_qualifying_withdrawal ? (
                        <span className="status positive">Tax-Free Qualifying</span>
                      ) : (
                        <span className="fine">-</span>
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
            <p className="eyebrow">FHSA BASELINE ROOM</p>
            <h2>Configure FHSA Room</h2>
            <form onSubmit={handleSaveRoom} className="stack">
              <label>
                Base Tax Year
                <input
                  type="number"
                  required
                  min="2023"
                  max="2035"
                  value={roomForm.base_year}
                  onChange={(e) => setRoomForm({ ...roomForm, base_year: e.target.value })}
                />
              </label>

              <label>
                Available Room on Jan 1 of Base Year (CAD)
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 8000"
                  value={roomForm.amount}
                  onChange={(e) => setRoomForm({ ...roomForm, amount: e.target.value })}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsRoomModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Save Room</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Transaction Modal */}
      {isDepositModalOpen && (
        <div className="modal-overlay" onClick={() => setIsDepositModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">RECORD FHSA ACTIVITY</p>
            <h2>Add FHSA Transaction</h2>
            <form onSubmit={handleSaveDeposit} className="stack">
              <div className="form-grid-2">
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

                <label>
                  <span>Type</span>
                  <select
                    value={depositForm.contribution_type}
                    onChange={(e) => setDepositForm({ ...depositForm, contribution_type: e.target.value })}
                  >
                    <option value="Deposit">Deposit (Contribution)</option>
                    <option value="Withdrawal">Withdrawal</option>
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
                    value={depositForm.amount}
                    onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                  />
                </label>

                <label>
                  <span>Date</span>
                  <input
                    type="date"
                    required
                    value={depositForm.contribution_date}
                    onChange={(e) => setDepositForm({ ...depositForm, contribution_date: e.target.value })}
                  />
                </label>
              </div>

              {depositForm.contribution_type === "Withdrawal" && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={depositForm.is_qualifying_withdrawal}
                    onChange={(e) => setDepositForm({ ...depositForm, is_qualifying_withdrawal: e.target.checked })}
                  />
                  Qualifying Tax-Free Withdrawal for First Home
                </label>
              )}

              <label>
                <span>Memo / Note</span>
                <input
                  type="text"
                  placeholder="e.g. Monthly contribution"
                  value={depositForm.memo}
                  onChange={(e) => setDepositForm({ ...depositForm, memo: e.target.value })}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsDepositModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Record Activity</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Account Modal */}
      {isAccountModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAccountModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">NEW FHSA ACCOUNT</p>
            <h2>Add FHSA Account</h2>
            <form onSubmit={handleSaveAccount} className="stack">
              <label>
                <span>Account Name</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. WealthSimple FHSA"
                  value={newAccountForm.account_name}
                  onChange={(e) => setNewAccountForm({ ...newAccountForm, account_name: e.target.value })}
                />
              </label>

              <label>
                <span>Account Number (optional)</span>
                <input
                  type="text"
                  placeholder="e.g. FHSA-54321"
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
