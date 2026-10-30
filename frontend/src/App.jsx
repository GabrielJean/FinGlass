import React, { useEffect, useState } from "react";
import { api, setCsrfToken } from "./api";
import { AuthView } from "./views/AuthView";
import { OverviewView } from "./views/OverviewView";
import { HoldingsView } from "./views/HoldingsView";
import { ChequingView } from "./views/ChequingView";
import { CreditCardView } from "./views/CreditCardView";
import { TfsaView } from "./views/TfsaView";
import { RrspView } from "./views/RrspView";
import { FhsaView } from "./views/FhsaView";
import { AcbView } from "./views/AcbView";
import { NetWorthView } from "./views/NetWorthView";
import { RetirementView } from "./views/RetirementView";
import { ImportWizardView } from "./views/ImportWizardView";
import { SettingsView } from "./views/SettingsView";
import { AdminUsersView } from "./views/AdminUsersView";

import {
  PieChart,
  Layers,
  TrendingUp,
  Wallet,
  CreditCard,
  ShieldCheck,
  Building,
  Home,
  LineChart,
  Compass,
  UploadCloud,
  Sliders,
  Users,
  LogOut,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";

const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : (window.__APP_VERSION__ || "1.0.0");

export function App() {
  const [ready, setReady] = useState(false);
  const [hasUsers, setHasUsers] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentView, setCurrentView] = useState("overview");
  const [viewParams, setViewParams] = useState({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    retirement_planner: true,
  });

  const getInitialViewFromPath = () => {
    const path = window.location.pathname.replace(/^\/|\/$/g, "");
    if (!path) return "overview";
    if (path === "holdings") return "holdings";
    if (path === "chequing") return "chequing";
    if (path === "credit-card") return "credit-card";
    if (path === "tfsa") return "tfsa";
    if (path === "rrsp") return "rrsp";
    if (path === "fhsa") return "fhsa";
    if (path === "retirement") return "retirement";
    if (path === "acb") return "acb";
    if (path.startsWith("security/")) {
      const sym = path.replace("security/", "");
      return { view: "acb", params: { symbol: sym } };
    }
    if (path === "net-worth") return "net-worth";
    if (path === "import") return "import";
    if (path === "app-admin") return "admin";
    if (path === "settings") return "settings";
    return "overview";
  };

  const navigateTo = (viewName, params = {}) => {
    setCurrentView(viewName);
    setViewParams(params);
    setMobileMenuOpen(false);

    let path = `/${viewName}`;
    if (viewName === "overview") path = "/";
    else if (viewName === "admin") path = "/app-admin";
    else if (viewName === "acb" && params.symbol) path = `/security/${params.symbol}`;

    if (window.location.pathname !== path) {
      window.history.pushState({ view: viewName, params }, "", path);
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      const init = getInitialViewFromPath();
      if (typeof init === "string") {
        setCurrentView(init);
        setViewParams({});
      } else {
        setCurrentView(init.view);
        setViewParams(init.params || {});
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const bootstrap = async () => {
    setReady(false);
    try {
      const setupCheck = await api.auth.checkSetup();
      setHasUsers(setupCheck.has_users);

      if (setupCheck.has_users) {
        try {
          const user = await api.auth.me();
          setCurrentUser(user);
          // Load features
          const featRes = await api.settings.getFeatures();
          if (featRes?.features) setFeatures(featRes.features);

          const init = getInitialViewFromPath();
          if (typeof init === "string") {
            setCurrentView(init);
          } else {
            setCurrentView(init.view);
            setViewParams(init.params);
          }
        } catch {
          setCurrentUser(null);
        }
      }
    } catch {
      // Offline or network error
    } finally {
      setReady(true);
    }
  };

  useEffect(() => {
    bootstrap();
  }, []);

  const handleLogout = async () => {
    try {
      await api.auth.logout();
    } finally {
      setCurrentUser(null);
      navigateTo("overview");
    }
  };

  if (!ready) {
    return <div className="loading">Connecting to FinGlass...</div>;
  }

  if (!currentUser) {
    return (
      <AuthView
        hasUsers={hasUsers}
        onAuthenticated={(user) => {
          setCurrentUser(user);
          bootstrap();
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="wordmark">
            Fin<span>Glass</span>
            <span className="badge">v{APP_VERSION}</span>
          </div>
        </div>

        <div className="signal" style={{ marginTop: "1.25rem", padding: "0.45rem 0.8rem", fontSize: "0.8rem" }}>
          <span></span> Private Workspace
        </div>

        <nav>
          <div className="nav-category">PORTFOLIO</div>
          <button
            type="button"
            className={currentView === "overview" ? "selected" : ""}
            onClick={() => navigateTo("overview")}
          >
            <PieChart size={17} /> Overview
          </button>

          {features.holdings_overview && (
            <button
              type="button"
              className={currentView === "holdings" ? "selected" : ""}
              onClick={() => navigateTo("holdings")}
            >
              <Layers size={17} /> Holdings & Assets
            </button>
          )}

          {features.acb_tracker && (
            <button
              type="button"
              className={currentView === "acb" ? "selected" : ""}
              onClick={() => navigateTo("acb")}
            >
              <TrendingUp size={17} /> Capital Gains (ACB)
            </button>
          )}

          {(features.chequing_tracker || features.credit_card) && (
            <div className="nav-category">BANKING & EXPENSES</div>
          )}

          {features.chequing_tracker && (
            <button
              type="button"
              className={currentView === "chequing" ? "selected" : ""}
              onClick={() => navigateTo("chequing")}
            >
              <Wallet size={17} /> Chequing & Cash Flow
            </button>
          )}

          {features.credit_card && (
            <button
              type="button"
              className={currentView === "credit-card" ? "selected" : ""}
              onClick={() => navigateTo("credit-card")}
            >
              <CreditCard size={17} /> Credit Cards & Spend
            </button>
          )}

          {(features.tfsa_tracker || features.rrsp_tracker || features.fhsa_tracker || features.retirement_planner) && (
            <div className="nav-category">TAX SHELTERS & RETIREMENT</div>
          )}

          {features.tfsa_tracker && (
            <button
              type="button"
              className={currentView === "tfsa" ? "selected" : ""}
              onClick={() => navigateTo("tfsa")}
            >
              <ShieldCheck size={17} /> TFSA (Tax-Free Room)
            </button>
          )}

          {features.rrsp_tracker && (
            <button
              type="button"
              className={currentView === "rrsp" ? "selected" : ""}
              onClick={() => navigateTo("rrsp")}
            >
              <Building size={17} /> RRSP (Tax Deduction)
            </button>
          )}

          {features.fhsa_tracker && (
            <button
              type="button"
              className={currentView === "fhsa" ? "selected" : ""}
              onClick={() => navigateTo("fhsa")}
            >
              <Home size={17} /> FHSA (First Home)
            </button>
          )}

          {features.retirement_planner && (
            <button
              type="button"
              className={currentView === "retirement" ? "selected" : ""}
              onClick={() => navigateTo("retirement")}
            >
              <Compass size={17} /> Retirement & Pension
            </button>
          )}

          <div className="nav-category">PLANNING & TOOLS</div>
          {features.net_worth && (
            <button
              type="button"
              className={currentView === "net-worth" ? "selected" : ""}
              onClick={() => navigateTo("net-worth")}
            >
              <LineChart size={17} /> Net Worth Tracker
            </button>
          )}

          {features.imports && (
            <button
              type="button"
              className={currentView === "import" ? "selected" : ""}
              onClick={() => navigateTo("import")}
            >
              <UploadCloud size={17} /> Import Statements & CSV
            </button>
          )}

          <button
            type="button"
            className={currentView === "settings" ? "selected" : ""}
            onClick={() => navigateTo("settings")}
          >
            <Sliders size={17} /> Settings & Features
          </button>

          {currentUser.is_superuser && (
            <button
              type="button"
              className={currentView === "admin" ? "selected" : ""}
              onClick={() => navigateTo("admin")}
            >
              <Users size={17} /> Admin Control
            </button>
          )}
        </nav>

        {/* Account Info Footer */}
        <div className="account">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{currentUser.username}</strong>
            <span className={`status ${currentUser.is_superuser ? "positive" : "info"}`} style={{ fontSize: "9px" }}>
              {currentUser.is_superuser ? "Admin" : "Member"}
            </span>
          </div>
          <small>{currentUser.is_superuser ? "Superuser Access" : "Standard User"}</small>
          <div className="account-actions">
            <button
              type="button"
              className="link"
              onClick={() => navigateTo("settings")}
              style={{ padding: 0 }}
            >
              Settings
            </button>
            <span style={{ color: "var(--border-panel)" }}>·</span>
            <button
              type="button"
              className="link destructive"
              onClick={handleLogout}
              style={{ padding: 0 }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <section className="content">
        {currentView === "overview" && <OverviewView onNavigate={navigateTo} />}
        {currentView === "holdings" && <HoldingsView onNavigate={navigateTo} />}
        {currentView === "chequing" && <ChequingView />}
        {currentView === "credit-card" && <CreditCardView />}
        {currentView === "tfsa" && <TfsaView />}
        {currentView === "rrsp" && <RrspView />}
        {currentView === "fhsa" && <FhsaView />}
        {currentView === "retirement" && <RetirementView />}
        {currentView === "acb" && <AcbView initialSymbol={viewParams?.symbol} />}
        {currentView === "net-worth" && <NetWorthView />}
        {currentView === "import" && <ImportWizardView />}
        {currentView === "settings" && (
          <SettingsView
            user={currentUser}
            onFeaturesChanged={(f) => setFeatures(f)}
          />
        )}
        {currentView === "admin" && <AdminUsersView currentUser={currentUser} />}

        <footer className="app-version">
          FinGlass v{APP_VERSION} · Canadian Personal Wealth Intelligence
        </footer>
      </section>
    </div>
  );
}

