import React, { useState } from "react";
import { api, setCsrfToken } from "../api";

const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : (window.__APP_VERSION__ || "1.0.0");

export function AuthView({ onAuthenticated, hasUsers }) {
  const [mode, setMode] = useState(hasUsers ? "login" : "setup"); // 'login' | 'register' | 'setup'
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!username.trim() || !password) {
      setError("Please enter both username and password.");
      return;
    }

    if (mode === "setup" || mode === "register") {
      if (password.length < 8) {
        setError("Password must be at least 8 characters long.");
        return;
      }
      if (confirmPassword && password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === "setup") {
        const user = await api.auth.setupSuperuser(username.trim(), password);
        onAuthenticated(user);
      } else if (mode === "login") {
        const user = await api.auth.login(username.trim(), password);
        onAuthenticated(user);
      } else if (mode === "register") {
        const user = await api.auth.register(username.trim(), password);
        onAuthenticated(user);
      }
    } catch (err) {
      setError(err.message || "Authentication failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="brand-panel">
        <p className="eyebrow">PORTFOLIO & WEALTH INTELLIGENCE</p>
        <h1>
          Crystal clarity for <span>your wealth.</span>
        </h1>
        <p>
          Track Canadian investments, adjusted cost base (ACB), registered accounts (TFSA, RRSP, FHSA),
          chequing, and credit cards with complete financial visibility and zero subscription telemetry.
        </p>

        <div className="signal">
          <span></span> Self-hosted private wealth dashboard.
        </div>
      </section>

      <section className="auth-card">
        <p className="eyebrow">
          {mode === "setup"
            ? "INITIAL SYSTEM SETUP"
            : mode === "login"
            ? "WELCOME BACK"
            : "CREATE USER ACCOUNT"}
        </p>
        <h2>
          {mode === "setup"
            ? "Setup Superadmin"
            : mode === "login"
            ? "Sign in to FinGlass"
            : "Create account"}
        </h2>

        {mode === "setup" && (
          <p className="fine" style={{ marginBottom: "1rem" }}>
            No administrator account exists yet. The first account created will be granted full superuser privileges.
          </p>
        )}

        {error && <div className="error-banner">{error}</div>}
        {notice && <div className="notice">{notice}</div>}

        <form onSubmit={handleSubmit}>
          <label>
            <span>Username</span>
            <input
              type="text"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. gabriel"
              autoComplete="username"
            />
          </label>

          <label>
            <span>Password</span>
            <input
              type="password"
              required
              minLength={mode === "setup" || mode === "register" ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          {(mode === "setup" || mode === "register") && (
            <label>
              <span>Confirm password</span>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="new-password"
              />
            </label>
          )}

          <button type="submit" disabled={loading}>
            {loading
              ? "Authenticating..."
              : mode === "setup"
              ? "Create Superadmin & Launch"
              : mode === "login"
              ? "Sign In"
              : "Register Account"}
          </button>
        </form>

        {mode !== "setup" && (
          <div style={{ marginTop: "1.25rem", textAlign: "center" }}>
            <button
              type="button"
              className="link"
              onClick={() => {
                setError("");
                setMode(mode === "login" ? "register" : "login");
              }}
            >
              {mode === "login"
                ? "Need an account? Register"
                : "Already have an account? Sign in"}
            </button>
          </div>
        )}

        <footer className="app-version" style={{ marginTop: "2rem" }}>
          FinGlass v{APP_VERSION} · Canadian Personal Wealth Intelligence
        </footer>
      </section>
    </main>
  );
}

