import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Sliders, Lock, CheckCircle, Info, ShieldCheck } from "lucide-react";

export function SettingsView({ user, onFeaturesChanged }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [features, setFeatures] = useState({
    imports: true,
    holdings_overview: true,
    acb_tracker: true,
    net_worth: true,
    credit_card: true,
    chequing_tracker: true,
    tfsa_tracker: true,
    rrsp_tracker: true,
    fhsa_tracker: true,
  });

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.settings.getFeatures();
      if (res?.features) {
        setFeatures(res.features);
      }
    } catch (err) {
      setError(err.message || "Failed to load feature settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleToggleFeature = async (key) => {
    const updated = { ...features, [key]: !features[key] };
    setFeatures(updated);
    try {
      const res = await api.settings.updateFeatures(updated);
      setNotice("Feature preferences saved.");
      if (onFeaturesChanged) onFeaturesChanged(res.features);
    } catch (err) {
      setError(err.message || "Failed to save feature setting.");
      setFeatures(features); // revert
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setPasswordLoading(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      setNotice("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.message || "Failed to change password.");
    } finally {
      setPasswordLoading(false);
    }
  };

  const featureLabels = [
    { key: "holdings_overview", label: "Holdings & Market Quotes", desc: "Live-priced stock, ETF, and cash accounts." },
    { key: "acb_tracker", label: "ACB & Capital Gains Tracker", desc: "Canadian adjusted cost base calculation for non-registered accounts." },
    { key: "chequing_tracker", label: "Chequing Cash Flow Tracker", desc: "WealthSimple monthly cash flow, categories, and savings." },
    { key: "credit_card", label: "Credit Card Spending Tracker", desc: "Rogers & Scotiabank statement imports, merchant analysis, cash back." },
    { key: "tfsa_tracker", label: "TFSA Contribution Room Tracker", desc: "CRA Tax-Free Savings Account limits and withdrawal carry-forwards." },
    { key: "rrsp_tracker", label: "RRSP Deduction Limit Tracker", desc: "Registered Retirement Savings Plan deduction room & unused deductions." },
    { key: "fhsa_tracker", label: "FHSA Home Savings Tracker", desc: "First Home Savings Account $40,000 lifetime room and withdrawals." },
    { key: "net_worth", label: "Historical Net Worth Tracker", desc: "Periodic net worth snapshot progression timeline." },
    { key: "imports", label: "Import Wizard & Data Portability", desc: "Staged statement review, CSV templates, full database exports." },
  ];

  return (
    <div>
      <header>
        <p className="eyebrow">SYSTEM & SECURITY CONFIGURATION</p>
        <h1>Settings & Preferences</h1>
        <p>Enable or disable dashboard modules and manage security credentials.</p>
      </header>

      {error && <div className="error-banner" style={{ marginBottom: "1rem" }}>{error}</div>}
      {notice && (
        <div className="success-banner" style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between" }}>
          <span>{notice}</span>
          <button type="button" className="link" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      {/* Feature Flags Grid */}
      <section className="panel">
        <div className="panel-header">
          <h3>Active Modules & Navigators</h3>
        </div>
        <p className="fine" style={{ marginBottom: "1.25rem" }}>
          Customize your navigation bar. Modules toggled off will be hidden from the sidebar to streamline your workspace.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "0.85rem" }}>
          {featureLabels.map((f) => (
            <label
              key={f.key}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.85rem",
                padding: "1rem",
                borderRadius: "10px",
                background: features[f.key] ? "rgba(56, 189, 248, 0.08)" : "rgba(10, 20, 36, 0.6)",
                border: features[f.key] ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid var(--border-input)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <input
                type="checkbox"
                checked={Boolean(features[f.key])}
                onChange={() => handleToggleFeature(f.key)}
                style={{ marginTop: "0.25rem", width: "auto", accentColor: "var(--accent)" }}
              />
              <div style={{ display: "grid", gap: "0.15rem" }}>
                <strong style={{ color: features[f.key] ? "#fff" : "#9cb2ce", fontSize: "0.92rem" }}>
                  {f.label}
                </strong>
                <span className="fine">{f.desc}</span>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Security & Password */}
      <section className="panel" style={{ maxWidth: "560px" }}>
        <div className="panel-header">
          <h3>Security & Password</h3>
        </div>

        <form onSubmit={handleChangePassword} className="stack">
          <label>
            Current Password
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••••••"
            />
          </label>

          <label>
            New Password
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>

          <label>
            Confirm New Password
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
            />
          </label>

          <button type="submit" disabled={passwordLoading} style={{ justifySelf: "start" }}>
            <Lock size={15} />
            {passwordLoading ? "Updating..." : "Update Password"}
          </button>
        </form>
      </section>

      {/* Instance Information */}
      <section className="panel" style={{ maxWidth: "560px" }}>
        <div className="panel-header">
          <h3>System Information</h3>
        </div>
        <div style={{ display: "grid", gap: "0.6rem", fontSize: "0.88rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="fine">Authenticated User:</span>
            <strong>{user?.username}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="fine">User Role:</span>
            <span className={`status ${user?.is_superuser ? "positive" : "info"}`}>
              {user?.is_superuser ? "Superadministrator" : "Member"}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="fine">Application Engine:</span>
            <span className="mono">FinGlass v1.0.0 (Vite + React)</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="fine">Target Jurisdiction:</span>
            <span>Canada (CAD / CRA Tax Rules)</span>
          </div>
        </div>
      </section>
    </div>
  );
}

