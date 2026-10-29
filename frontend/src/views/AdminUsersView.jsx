import React, { useEffect, useState } from "react";
import { api } from "../api";
import { formatDate, formatDateTime } from "../utils/formatters";
import {
  Users,
  ShieldAlert,
  KeyRound,
  Trash2,
  CheckCircle2,
  XCircle,
  FileClock,
  Database,
  Download,
  UploadCloud,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

export function AdminUsersView({ currentUser }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [users, setUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [activeTab, setActiveTab] = useState("users"); // 'users' | 'audit' | 'database'

  // Password reset modal
  const [pwdUser, setPwdUser] = useState(null);
  const [newPassword, setNewPassword] = useState("");

  // Delete modal
  const [delUser, setDelUser] = useState(null);
  const [confirmName, setConfirmName] = useState("");

  // Database management state
  const [dbExporting, setDbExporting] = useState(false);
  const [dbImporting, setDbImporting] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [confirmOverwriteModal, setConfirmOverwriteModal] = useState(false);
  const [overwriteConfirmText, setOverwriteConfirmText] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [uRes, aRes] = await Promise.all([
        api.admin.getUsers(),
        api.admin.getAuditLogs(100),
      ]);
      const userList = Array.isArray(uRes) ? uRes : (uRes?.users || []);
      const auditList = Array.isArray(aRes) ? aRes : (aRes?.logs || []);
      setUsers(userList);
      setAuditLogs(auditList);
    } catch (err) {
      setError(err.message || "Failed to load admin user data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleActive = async (targetUser) => {
    const nextState = !targetUser.is_active;
    try {
      await api.admin.setUserActive(targetUser.id, nextState);
      setNotice(`Updated account status for ${targetUser.username}.`);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to update account status.");
    }
  };

  const handleToggleAdmin = async (targetUser) => {
    const nextState = !targetUser.is_superuser;
    try {
      await api.admin.setUserSuperuser(targetUser.id, nextState);
      setNotice(`Updated admin privileges for ${targetUser.username}.`);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to change admin permissions.");
    }
  };

  const handleSetPassword = async (e) => {
    e.preventDefault();
    if (!pwdUser || !newPassword) return;
    try {
      await api.admin.setUserPassword(pwdUser.id, newPassword);
      setNotice(`Reset password for ${pwdUser.username}.`);
      setPwdUser(null);
      setNewPassword("");
      loadData();
    } catch (err) {
      setError(err.message || "Failed to reset password.");
    }
  };

  const handleDeleteUser = async (e) => {
    e.preventDefault();
    if (!delUser || confirmName !== delUser.username) return;
    try {
      await api.admin.deleteUser(delUser.id, confirmName);
      setNotice(`Deleted account ${delUser.username}.`);
      setDelUser(null);
      setConfirmName("");
      loadData();
    } catch (err) {
      setError(err.message || "Failed to delete account.");
    }
  };

  const handleExportDatabase = async () => {
    setDbExporting(true);
    setError("");
    setNotice("");
    try {
      await api.admin.exportDatabase();
      setNotice("Application database backup downloaded successfully.");
    } catch (err) {
      setError(err.message || "Failed to download database.");
    } finally {
      setDbExporting(false);
    }
  };

  const handleImportDatabase = async () => {
    if (!importFile || overwriteConfirmText !== "OVERWRITE") return;
    setDbImporting(true);
    setError("");
    setNotice("");
    try {
      const res = await api.admin.importDatabase(importFile);
      setConfirmOverwriteModal(false);
      setImportFile(null);
      setNotice(res.message || "Database imported and overwritten successfully! Reloading...");
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      setError(err.message || "Failed to import database.");
      setDbImporting(false);
    }
  };

  return (
    <div>
      <div className="top-bar">
        <div>
          <p className="eyebrow">SYSTEM SECURITY DESK</p>
          <h1>Administration & User Control</h1>
          <p>Superuser privileges, account activations, database management, and audit event logs.</p>
        </div>

        <div className="tabs" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className={`tab-btn ${activeTab === "users" ? "active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            Accounts ({Array.isArray(users) ? users.length : 0})
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "audit" ? "active" : ""}`}
            onClick={() => setActiveTab("audit")}
          >
            Audit Trail ({Array.isArray(auditLogs) ? auditLogs.length : 0})
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "database" ? "active" : ""}`}
            onClick={() => setActiveTab("database")}
          >
            <Database size={13} style={{ marginRight: 6, display: "inline-block", verticalAlign: "middle" }} />
            Database Backup & Restore
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

      {activeTab === "users" && (
        <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
          {loading ? (
            <div className="loading" style={{ minHeight: "200px" }}>Loading accounts...</div>
          ) : (
            <div className="table-wrap" style={{ border: "none" }}>
              <table>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Last Login</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(users) ? users : []).map((u) => {
                    const isSelf = u.id === currentUser?.id;

                    return (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.username}</strong>
                          {isSelf && <span className="fine" style={{ marginLeft: 6 }}>(You)</span>}
                        </td>
                        <td>
                          <span className={`status ${u.is_superuser ? "positive" : "info"}`}>
                            {u.is_superuser ? "Administrator" : "Standard Member"}
                          </span>
                        </td>
                        <td>
                          <span className={`status ${u.is_active ? "positive" : "negative"}`}>
                            {u.is_active ? "Active" : "Deactivated"}
                          </span>
                        </td>
                        <td className="fine">{formatDate(u.created_at)}</td>
                        <td className="fine">{u.last_login ? formatDateTime(u.last_login) : "Never"}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            className="secondary"
                            style={{ padding: "0.35rem 0.65rem", fontSize: "0.8rem", marginRight: "0.4rem" }}
                            onClick={() => {
                              setPwdUser(u);
                              setNewPassword("");
                            }}
                          >
                            <KeyRound size={13} /> Password
                          </button>

                          {!isSelf && (
                            <>
                              <button
                                type="button"
                                className="secondary"
                                style={{ padding: "0.35rem 0.65rem", fontSize: "0.8rem", marginRight: "0.4rem" }}
                                onClick={() => handleToggleAdmin(u)}
                              >
                                {u.is_superuser ? "Revoke Admin" : "Grant Admin"}
                              </button>

                              <button
                                type="button"
                                className={u.is_active ? "outline" : "secondary"}
                                style={{ padding: "0.35rem 0.65rem", fontSize: "0.8rem", marginRight: "0.4rem" }}
                                onClick={() => handleToggleActive(u)}
                              >
                                {u.is_active ? "Deactivate" : "Activate"}
                              </button>

                              <button
                                type="button"
                                className="danger"
                                style={{ padding: "0.35rem 0.65rem", fontSize: "0.8rem" }}
                                onClick={() => {
                                  setDelUser(u);
                                  setConfirmName("");
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === "audit" && (
        /* Audit Trail Table */
        <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
          {loading ? (
            <div className="loading" style={{ minHeight: "200px" }}>Loading logs...</div>
          ) : auditLogs.length === 0 ? (
            <div className="empty">
              <h3>No administrative actions recorded</h3>
              <p>Security operations such as user additions, permission modifications, and database operations appear here.</p>
            </div>
          ) : (
            <div className="table-wrap" style={{ border: "none" }}>
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Target User</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(auditLogs) ? auditLogs : []).map((log) => (
                    <tr key={log.id}>
                      <td className="mono fine">{formatDateTime(log.created_at)}</td>
                      <td>
                        <span className={`status ${log.action_type.includes("RESTORE") ? "negative" : log.action_type.includes("EXPORT") ? "positive" : "info"}`}>
                          {log.action_type}
                        </span>
                      </td>
                      <td><strong>{log.actor_username || "System"}</strong></td>
                      <td>{log.target_username || "-"}</td>
                      <td className="fine">
                        {log.details && Object.keys(log.details).length > 0
                          ? JSON.stringify(log.details)
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === "database" && (
        <div className="stack" style={{ gap: "1.75rem" }}>
          {/* Download Full Database Snapshot */}
          <section className="panel">
            <div className="panel-header">
              <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                <Database size={20} color="var(--accent)" />
                <h2 style={{ fontSize: "1.2rem", margin: 0 }}>Export & Download Application Database</h2>
              </div>
              <span className="status positive">Live SQLite Snapshot</span>
            </div>

            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", lineHeight: 1.6, margin: "0 0 1.25rem" }}>
              Download a complete, transactionally-consistent snapshot of the active SQLite database directly to your computer. This full snapshot contains all registered accounts, portfolios, ACB history, banking flows, credit card ledger records, and CRA contribution tracking.
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleExportDatabase}
                disabled={dbExporting}
              >
                <Download size={15} />
                {dbExporting ? "Generating database snapshot..." : "Download SQL Database (.sqlite3)"}
              </button>
              <span className="fine" style={{ color: "var(--text-fine)" }}>
                Online backup runs via SQLite WAL backup engine without locking active reads.
              </span>
            </div>
          </section>

          {/* Import and Overwrite Database */}
          <section className="panel" style={{ borderColor: "rgba(248, 113, 113, 0.35)", background: "rgba(239, 68, 68, 0.03)" }}>
            <div className="panel-header" style={{ borderBottomColor: "rgba(248, 113, 113, 0.2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                <AlertTriangle size={20} color="var(--negative)" />
                <h2 style={{ fontSize: "1.2rem", margin: 0, color: "#fca5a5" }}>Import & Overwrite Application Database</h2>
              </div>
              <span className="status negative">Destructive Action</span>
            </div>

            <div className="error-banner" style={{ marginBottom: "1.25rem", background: "rgba(239, 68, 68, 0.12)", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
              <strong>CRITICAL WARNING:</strong> Uploading a database file will <u>completely overwrite and replace all existing data</u> in this FinGlass instance. All current accounts, transactions, imported records, and settings will be permanently lost and replaced with the uploaded file.
            </div>

            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", lineHeight: 1.6, margin: "0 0 1.25rem" }}>
              Select a valid FinGlass SQLite database file (<code>.sqlite3</code> or <code>.db</code>). The system will verify file integrity, validate internal schema tables, restore the data, and run any pending migrations before reloading.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "560px" }}>
              <label>
                <span>Select Database File</span>
                <input
                  type="file"
                  accept=".sqlite3,.db,application/vnd.sqlite3,application/x-sqlite3"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setImportFile(file);
                    setError("");
                  }}
                />
              </label>

              {importFile && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-input)", padding: "0.75rem 1rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-input)", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <strong style={{ fontSize: "0.88rem", display: "block" }}>{importFile.name}</strong>
                    <span className="fine" style={{ color: "var(--text-fine)" }}>
                      {(importFile.size / (1024 * 1024)).toFixed(2)} MB · Ready for restore
                    </span>
                  </div>
                  <button
                    type="button"
                    className="danger"
                    disabled={dbImporting}
                    onClick={() => {
                      setOverwriteConfirmText("");
                      setConfirmOverwriteModal(true);
                    }}
                  >
                    <UploadCloud size={15} />
                    Import & Overwrite
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Overwrite Confirmation Modal */}
      {confirmOverwriteModal && importFile && (
        <div className="modal-overlay" onClick={() => !dbImporting && setConfirmOverwriteModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ borderColor: "rgba(248, 113, 113, 0.5)" }}>
            <p className="eyebrow" style={{ color: "var(--negative)" }}>DANGER: DATABASE REPLACEMENT</p>
            <h2 style={{ color: "#fca5a5" }}>Overwrite Whole Database?</h2>

            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", lineHeight: 1.6 }}>
              You are about to overwrite all current data with <strong>{importFile.name}</strong> ({(importFile.size / (1024 * 1024)).toFixed(2)} MB).
            </p>
            <p className="fine" style={{ color: "#fca5a5", marginTop: "0.5rem" }}>
              This cannot be undone. To proceed, please type <strong>OVERWRITE</strong> below:
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleImportDatabase();
              }}
              className="stack"
              style={{ marginTop: "1rem" }}
            >
              <label>
                <span>Confirmation Phrase</span>
                <input
                  type="text"
                  required
                  placeholder="OVERWRITE"
                  value={overwriteConfirmText}
                  onChange={(e) => setOverwriteConfirmText(e.target.value)}
                  disabled={dbImporting}
                  autoFocus
                />
              </label>

              <div className="modal-footer">
                <button
                  type="button"
                  className="secondary"
                  disabled={dbImporting}
                  onClick={() => setConfirmOverwriteModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="danger"
                  disabled={overwriteConfirmText !== "OVERWRITE" || dbImporting}
                >
                  {dbImporting ? (
                    <>
                      <RefreshCw size={14} className="spin" /> Overwriting database...
                    </>
                  ) : (
                    "Confirm & Overwrite All Data"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Set Password Modal */}
      {pwdUser && (
        <div className="modal-overlay" onClick={() => setPwdUser(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">ADMIN PASSWORD OVERRIDE</p>
            <h2>Reset Password for {pwdUser.username}</h2>
            <form onSubmit={handleSetPassword} className="stack">
              <label>
                <span>New Password</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setPwdUser(null)}>
                  Cancel
                </button>
                <button type="submit">Update Password</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Modal */}
      {delUser && (
        <div className="modal-overlay" onClick={() => setDelUser(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">CONFIRM DELETION</p>
            <h2>Delete Account {delUser.username}</h2>
            <p className="fine">
              This action is permanent and will delete the user account and associated audit ownership. Type <strong>{delUser.username}</strong> below to confirm.
            </p>

            <form onSubmit={handleDeleteUser} className="stack">
              <label>
                <span>Confirm Username</span>
                <input
                  type="text"
                  required
                  placeholder={delUser.username}
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setDelUser(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="danger"
                  disabled={confirmName !== delUser.username}
                >
                  Delete Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

