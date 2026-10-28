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
} from "lucide-react";

export function AdminUsersView({ currentUser }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [users, setUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [activeTab, setActiveTab] = useState("users"); // 'users' | 'audit'

  // Password reset modal
  const [pwdUser, setPwdUser] = useState(null);
  const [newPassword, setNewPassword] = useState("");

  // Delete modal
  const [delUser, setDelUser] = useState(null);
  const [confirmName, setConfirmName] = useState("");

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

  return (
    <div>
      <div className="top-bar">
        <div>
          <p className="eyebrow">SYSTEM SECURITY DESK</p>
          <h1>Administration & User Control</h1>
          <p>Superuser privileges, account activations, and audit event logs.</p>
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
        </div>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: "1rem" }}>{error}</div>}
      {notice && (
        <div className="success-banner" style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between" }}>
          <span>{notice}</span>
          <button type="button" className="link" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      {activeTab === "users" ? (
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
      ) : (
        /* Audit Trail Table */
        <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
          {loading ? (
            <div className="loading" style={{ minHeight: "200px" }}>Loading logs...</div>
          ) : auditLogs.length === 0 ? (
            <div className="empty">
              <h3>No administrative actions recorded</h3>
              <p>Security operations such as user additions and permission modifications appear here.</p>
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
                        <span className="status info">{log.action_type}</span>
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

