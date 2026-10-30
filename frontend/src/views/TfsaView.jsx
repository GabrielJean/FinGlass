import React, { useEffect, useState, useRef } from "react";
import { api } from "../api";
import { formatMoney, formatDate } from "../utils/formatters";
import {
  Upload,
  Plus,
  Trash2,
  Settings,
  ArrowRightLeft,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

export function TfsaView() {
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
        api.tfsa.getSummary(),
        api.tfsa.getAccounts(),
        api.tfsa.getAnnualLimits(),
        api.tfsa.getTransactions(),
        api.tfsa.getOpeningBalance(),
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
      setError(err.message || "Failed to load TFSA details.");
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
      await api.tfsa.setOpeningBalance(Number(roomForm.amount), Number(roomForm.base_year));
      setNotice("TFSA baseline room successfully updated.");
      setIsRoomModalOpen(false);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to update TFSA room.");
    }
  };

  const handleSaveDeposit = async (e) => {
    e.preventDefault();
    try {
      await api.tfsa.createContribution({
        tfsa_account_id: Number(depositForm.account_id),
        contribution_date: depositForm.contribution_date,
        amount: Number(depositForm.amount),
        contribution_type: depositForm.contribution_type,
        memo: depositForm.memo,
      });
      setNotice(`Recorded TFSA ${depositForm.contribution_type}.`);
      setIsDepositModalOpen(false);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to record transaction.");
    }
  };

  const handleSaveTransfer = async (e) => {
    e.preventDefault();
    try {
      await api.tfsa.createTransfer({
        from_account_id: Number(transferForm.from_account_id),
        to_account_id: Number(transferForm.to_account_id),
        transfer_date: transferForm.transfer_date,
        amount: Number(transferForm.amount),
        memo: transferForm.memo,
      });
      setNotice("TFSA institution transfer recorded.");
      setIsTransferModalOpen(false);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to record transfer.");
    }
  };

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    try {
      await api.tfsa.createAccount(newAccountForm);
      setNotice(`Created account ${newAccountForm.account_name}.`);
      setIsAccountModalOpen(false);
      setNewAccountForm({ account_name: "", account_number: "", opening_balance: 0 });
      loadData();
    } catch (err) {
      setError(err.message || "Failed to create account.");
    }
  };

  const handleDeleteTx = async (id) => {
    if (!window.confirm("Delete this TFSA record?")) return;
    try {
      await api.tfsa.deleteTransaction(id);
      setNotice("Record deleted.");
      loadData();
    } catch (err) {
      setError(err.message || "Failed to delete.");
    }
  };

  const handleReset = async () => {
    if (!window.confirm("WARNING: This will reset all TFSA contributions and room history. Continue?")) return;
    try {
      await api.tfsa.reset();
      setNotice("TFSA room and records have been reset.");
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
      const res = await api.tfsa.importCsv(formData);
      setNotice(`Successfully imported ${res.imported_count || res.count || "TFSA"} transactions.`);
      loadData();
    } catch (err) {
      setError(err.message || "CSV Import failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const isRoomConfigured = Boolean(
    openingBalance?.configured ||
    summary?.configured ||
    summary?.opening_balance_configured
  );

  if (loading && !summary) {
    return <div className="loading">Loading TFSA details...</div>;
  }

  const availableRoom = Number(summary?.total_available_room || 0);
  const remainingRoom = Number(summary?.total_remaining ?? summary?.current_year_room ?? 0);
  const usedRoom = Number(summary?.room_used ?? summary?.total_used ?? 0);
  const totalDeposits = Number(summary?.total_deposits ?? summary?.current_year_contributions ?? 0);
  const totalWithdrawals = Number(summary?.total_withdrawals ?? summary?.current_year_withdrawals ?? 0);
  const roomStatus = summary?.room_status || (remainingRoom <= 0 && availableRoom > 0 ? "full" : "normal");

  const usedPct = availableRoom > 0 ? Math.min(100, Math.max(0, (usedRoom / availableRoom) * 100)) : 0;
  const remainingPct = availableRoom > 0 ? Math.min(100, Math.max(0, (remainingRoom / availableRoom) * 100)) : 0;

  const barColor = roomStatus === "over-limit"
    ? "#ef4444"
    : roomStatus === "near-limit"
    ? "#f59e0b"
    : roomStatus === "full"
    ? "#10b981"
    : "var(--accent)";

  return (
    <div>
      <div className="top-bar">
        <div>
          <p className="eyebrow">CRA REGISTERED TAX SHELTER</p>
          <h1>Tax-Free Savings Account (TFSA)</h1>
          <p>Official CRA contribution room calculation, withdrawals, and institution transfers.</p>
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
            {uploading ? "Importing..." : "Import TFSA CSV"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setIsRoomModalOpen(true)}
          >
            <Settings size={15} />
            Set CRA Room
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
            Add Deposit/Withdrawal
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
            <AlertCircle size={20} color="var(--accent)" />
            <span>
              Your baseline TFSA contribution room has not been configured yet. Set your available room from your CRA Notice of Assessment to track your remaining limit accurately.
            </span>
          </div>
          <button type="button" onClick={() => setIsRoomModalOpen(true)}>
            Set Room Now
          </button>
        </div>
      )}

      {/* Friendly Co-Pilot Explainer */}
      <div className="friendly-explainer">
        <div className="friendly-explainer-icon">🇨🇦</div>
        <div>
          <h4 className="friendly-explainer-title">TFSA in Plain English</h4>
          <p className="friendly-explainer-text">
            The Tax-Free Savings Account (TFSA) is Canada's most powerful tax shelter. Any money you deposit grows <strong>100% tax-free</strong>. You can withdraw your money at any time without paying income tax, and whatever amount you withdraw is added back to your contribution room on January 1st of the following year!
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="kpi-label">Remaining TFSA Room</span>
            {roomStatus && roomStatus !== "normal" && (
              <span className={`room-badge ${roomStatus}`}>
                {roomStatus.replace("-", " ")}
              </span>
            )}
          </div>
          <span className="kpi-val" style={{ color: "var(--accent)" }}>
            {formatMoney(remainingRoom)}
          </span>
          <span className="kpi-sub">
            of <strong className="num">{formatMoney(availableRoom)}</strong> available CRA room
          </span>
          <div className="room-progress-wrap">
            <div className="room-progress-track">
              <div
                className="room-progress-fill"
                style={{ width: `${usedPct}%`, background: barColor }}
              />
            </div>
            <div className="room-progress-meta">
              <span>{usedPct.toFixed(1)}% utilized</span>
              <span>{remainingPct.toFixed(1)}% room left</span>
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Total Deposits</span>
          <span className="kpi-val text-positive">
            {formatMoney(totalDeposits)}
          </span>
          <span className="kpi-sub">
            {usedPct.toFixed(1)}% of total available room
          </span>
          <div className="room-progress-wrap">
            <div className="room-progress-track">
              <div
                className="room-progress-fill"
                style={{ width: `${usedPct}%`, background: "var(--positive)" }}
              />
            </div>
            <div className="room-progress-meta">
              <span>Net room used: {formatMoney(usedRoom)}</span>
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Total Withdrawals</span>
          <span className="kpi-val">
            {formatMoney(totalWithdrawals)}
          </span>
          <span className="kpi-sub">Re-added to room on Jan 1 next year</span>
          <div className="room-progress-wrap">
            <div className="room-progress-meta" style={{ marginTop: "0.85rem" }}>
              <span>Eligible added: {formatMoney(summary?.room_withdrawals_eligible || 0)}</span>
              <span>Pending: {formatMoney(summary?.room_withdrawals_pending || 0)}</span>
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">TFSA Accounts</span>
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
          <h3>TFSA Transactions Ledger</h3>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="link destructive" onClick={handleReset}>
              Reset TFSA
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading" style={{ minHeight: "200px" }}>Loading records...</div>
        ) : transactions.length === 0 ? (
          <div className="empty">
            <h3>No TFSA activity recorded</h3>
            <p>Log your contributions or import your statements to calculate your remaining CRA room.</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: "none" }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th>Memo / Details</th>
                  <th className="num">Amount</th>
                  <th style={{ textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(transactions) ? transactions : []).map((t) => {
                  const isDeposit = t.contribution_type === "deposit" || t.contribution_type === "contribution";
                  const isWithdrawal = t.contribution_type === "withdrawal";
                  const isTransfer = t.contribution_type === "transfer_in" || t.contribution_type === "transfer_out";

                  return (
                    <tr key={t.id}>
                      <td className="mono">{formatDate(t.contribution_date)}</td>
                      <td>
                        <strong>{t.account_name || "TFSA"}</strong>
                      </td>
                      <td>
                        <span
                          className={`status ${
                            isDeposit ? "positive" : isWithdrawal ? "warning" : "info"
                          }`}
                        >
                          {t.contribution_type.replace("_", " ")}
                        </span>
                      </td>
                      <td className="fine">{t.memo || "-"}</td>
                      <td
                        className={`num font-bold ${
                          isDeposit ? "text-positive" : isWithdrawal ? "text-negative" : ""
                        }`}
                      >
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* CRA Room Baseline Modal */}
      {isRoomModalOpen && (
        <div className="modal-overlay" onClick={() => setIsRoomModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">CRA BASELINE SETUP</p>
            <h2>Configure TFSA Contribution Room</h2>
            <p className="fine">
              Enter the available TFSA contribution room reported on your CRA My Account Notice of Assessment for your chosen base tax year.
            </p>

            <form onSubmit={handleSaveRoom} className="stack">
              <label>
                Base Tax Year
                <input
                  type="number"
                  required
                  min="2009"
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
                  placeholder="e.g. 35000"
                  value={roomForm.amount}
                  onChange={(e) => setRoomForm({ ...roomForm, amount: e.target.value })}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsRoomModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Save Baseline Room</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deposit / Withdrawal Modal */}
      {isDepositModalOpen && (
        <div className="modal-overlay" onClick={() => setIsDepositModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">RECORD TRANSACTION</p>
            <h2>Add TFSA Deposit or Withdrawal</h2>

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
                    placeholder="0.00"
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

              <label>
                <span>Memo / Note</span>
                <input
                  type="text"
                  placeholder="e.g. Monthly automated savings"
                  value={depositForm.memo}
                  onChange={(e) => setDepositForm({ ...depositForm, memo: e.target.value })}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsDepositModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Save Record</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {isTransferModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTransferModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">INSTITUTION TRANSFER</p>
            <h2>Direct TFSA-to-TFSA Transfer</h2>
            <p className="fine">
              Direct institution transfers do not affect your CRA contribution room.
            </p>

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
            <p className="eyebrow">NEW TFSA ACCOUNT</p>
            <h2>Add TFSA Account</h2>

            <form onSubmit={handleSaveAccount} className="stack">
              <label>
                <span>Account Name</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. WealthSimple Trade TFSA"
                  value={newAccountForm.account_name}
                  onChange={(e) => setNewAccountForm({ ...newAccountForm, account_name: e.target.value })}
                />
              </label>

              <label>
                <span>Account Number (optional)</span>
                <input
                  type="text"
                  placeholder="e.g. WS-98765"
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
