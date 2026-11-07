import React, { useState, useRef, useEffect } from "react";
import { api } from "../api";
import { formatMoney, formatDate } from "../utils/formatters";
import {
  Upload,
  Download,
  CheckCircle,
  AlertTriangle,
  Trash2,
  CreditCard,
  Building2,
  TrendingUp,
  PieChart,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export function ImportWizardView({ onNavigate }) {
  const [activeTab, setActiveTab] = useState("wizard"); // 'wizard' | 'backup'
  const [activeCategory, setActiveCategory] = useState("auto"); // 'auto' | 'chequing' | 'credit' | 'acb' | 'holdings' | 'registered'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastImportCategory, setLastImportCategory] = useState(null);

  // Staged review state (for investment ACB & tax slips)
  const [stagedBatch, setStagedBatch] = useState(null);
  const [acbMode, setAcbMode] = useState("staged"); // 'staged' | 'direct'

  // Chequing options
  const [chequingAccounts, setChequingAccounts] = useState([]);
  const [chequingLabel, setChequingLabel] = useState("");
  const [customChequingLabel, setCustomChequingLabel] = useState("");

  // Credit card options
  const [creditCards, setCreditCards] = useState([]);
  const [cardLabel, setCardLabel] = useState("");
  const [customCardLabel, setCustomCardLabel] = useState("");
  const [creditProvider, setCreditProvider] = useState("auto"); // 'auto' | 'wealthsimple' | 'rogers'

  // CRA Registered options
  const [registeredType, setRegisteredType] = useState("tfsa"); // 'tfsa' | 'rrsp' | 'fhsa'

  const fileInputRef = useRef(null);
  const backupInputRef = useRef(null);

  // Load existing accounts for quick label assignment
  useEffect(() => {
    async function loadAccountLabels() {
      try {
        const [cheqRes, ccRes] = await Promise.allSettled([
          api.chequing.getAccounts(),
          api.creditCard.getCards(),
        ]);
        if (cheqRes.status === "fulfilled" && Array.isArray(cheqRes.value)) {
          setChequingAccounts(cheqRes.value.map((a) => a.label || a.name || a));
          if (cheqRes.value.length > 0 && !chequingLabel) {
            setChequingLabel(cheqRes.value[0].label || cheqRes.value[0].name || cheqRes.value[0]);
          }
        }
        if (ccRes.status === "fulfilled" && Array.isArray(ccRes.value)) {
          setCreditCards(ccRes.value.map((c) => c.label || c.name || c));
          if (ccRes.value.length > 0 && !cardLabel) {
            setCardLabel(ccRes.value[0].label || ccRes.value[0].name || ccRes.value[0]);
          }
        }
      } catch {
        // Non-critical, fallback to manual label entry
      }
    }
    loadAccountLabels();
  }, []);

  // Sniff file header to auto-detect category if in auto mode
  const sniffCategory = async (file) => {
    const filename = (file.name || "").toLowerCase();
    const ext = filename.split(".").pop();

    if (ext === "pdf" || filename.includes("tax") || filename.includes("t3") || filename.includes("t5008")) {
      return "acb";
    }

    try {
      const slice = file.slice(0, 4096);
      const text = await slice.text();
      const lower = text.toLowerCase();

      // Chequing custom activity statement
      if (
        (lower.includes("account_number") && (lower.includes("payee") || lower.includes("transaction_sub_type"))) ||
        filename.includes("chequing") ||
        filename.includes("courant")
      ) {
        return "chequing";
      }

      // Credit card custom activity statement (Wealthsimple or Rogers Bank)
      if (
        lower.includes("merchant") ||
        lower.includes("card_last4") ||
        lower.includes("cardholder") ||
        lower.includes("posted_date") ||
        lower.includes("rewards") ||
        filename.includes("card-activities") ||
        filename.includes("credit-card") ||
        filename.includes("rogers")
      ) {
        return "credit";
      }

      // Holdings report
      if (
        lower.includes("market_price") ||
        lower.includes("market_value") ||
        lower.includes("book_value") ||
        filename.includes("holdings")
      ) {
        return "holdings";
      }

      // Registered CRA accounts
      if (filename.includes("tfsa")) return "registered_tfsa";
      if (filename.includes("rrsp")) return "registered_rrsp";
      if (filename.includes("fhsa")) return "registered_fhsa";

      // Non-registered Trade activities (ACB)
      if (
        lower.includes("activity_type") ||
        lower.includes("effective_date") ||
        lower.includes("noncashdistribution") ||
        lower.includes("returnofcapital") ||
        filename.includes("activities")
      ) {
        return "acb";
      }
    } catch {
      // Fallback
    }

    return "acb";
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setLoading(true);
    setError("");
    setNotice("");
    setLastImportCategory(null);

    try {
      let targetCat = activeCategory;
      if (targetCat === "auto") {
        targetCat = await sniffCategory(files[0]);
      }

      // 1. CHEQUING IMPORT
      if (targetCat === "chequing") {
        const formData = new FormData();
        files.forEach((file) => formData.append("file", file));
        const finalLabel = chequingLabel === "__new__" ? customChequingLabel.trim() : chequingLabel;
        if (finalLabel) {
          formData.append("account_label", finalLabel);
        }

        const res = await api.chequing.importCsv(formData);
        const inserted = res.inserted_count ?? res.inserted ?? res.imported ?? res.count ?? 0;
        const skipped = res.duplicates_skipped ?? res.skipped ?? 0;
        const msg = skipped > 0
          ? `Imported ${inserted} chequing transaction(s) across ${res.files || files.length} document(s) (${skipped} duplicate(s) recognized and skipped).`
          : `Successfully imported ${inserted} chequing transaction(s) across ${res.files || files.length} document(s).`;
        setNotice(msg);
        setLastImportCategory("chequing");
      }

      // 2. CREDIT CARD IMPORT
      else if (targetCat === "credit") {
        const formData = new FormData();
        files.forEach((file) => formData.append("file", file));
        const finalLabel = cardLabel === "__new__" ? customCardLabel.trim() : cardLabel;
        if (finalLabel) {
          formData.append("card_label", finalLabel);
        }
        if (creditProvider) {
          formData.append("provider", creditProvider);
        }

        const res = await api.creditCard.importRogersCsv(formData);
        const inserted = res.inserted_count ?? res.inserted ?? res.imported ?? res.count ?? 0;
        const skipped = res.duplicates_skipped ?? res.skipped ?? 0;
        const msg = skipped > 0
          ? `Imported ${inserted} credit card transaction(s) from ${res.files || files.length} document(s) (${skipped} duplicate(s) recognized and skipped).`
          : `Successfully imported ${inserted} credit card transaction(s) from ${res.files || files.length} document(s).`;
        setNotice(msg);
        setLastImportCategory("credit-card");
      }

      // 3. HOLDINGS REPORT IMPORT
      else if (targetCat === "holdings") {
        const formData = new FormData();
        formData.append("file", files[0]);

        const res = await api.holdings.importHoldingsCsv(formData);
        const imported = res.imported ?? res.inserted ?? res.parsed ?? 0;
        const asOfStr = res.as_of ? ` (as of ${res.as_of})` : "";
        setNotice(`Successfully imported ${imported} position(s) from Wealthsimple holdings report${asOfStr}. Previous snapshot updated.`);
        setLastImportCategory("holdings");
      }

      // 4. CRA TAX SHELTERS IMPORT
      else if (targetCat === "registered" || targetCat?.startsWith("registered_")) {
        const subtype = targetCat.startsWith("registered_") ? targetCat.replace("registered_", "") : registeredType;
        const formData = new FormData();
        formData.append("file", files[0]);

        let res;
        if (subtype === "rrsp") res = await api.rrsp.importCsv(formData);
        else if (subtype === "fhsa") res = await api.fhsa.importCsv(formData);
        else res = await api.tfsa.importCsv(formData);

        const count = res.imported_count || res.count || res.inserted || "several";
        setNotice(`Successfully imported ${count} transaction(s) into your ${subtype.toUpperCase()} account.`);
        setLastImportCategory(subtype);
      }

      // 5. INVESTMENT TRADES & ACB (DEFAULT / ACB)
      else {
        if (acbMode === "direct") {
          const formData = new FormData();
          files.forEach((file) => formData.append("file", file));
          const res = await api.acb.importCsv(formData);
          const inserted = res.inserted ?? res.imported ?? res.count ?? 0;
          const skipped = res.skipped_existing ?? res.skipped ?? 0;
          const msg = skipped > 0
            ? `Successfully imported ${inserted} trade/distribution row(s) (${skipped} duplicate(s) in ledger skipped).`
            : `Successfully imported ${inserted} trade/distribution row(s) to ACB ledger.`;
          setNotice(msg);
          setLastImportCategory("acb");
        } else {
          // Interactive Staging Review
          const formData = new FormData();
          files.forEach((file) => formData.append("file", file));
          formData.append("import_type", "auto");
          formData.append("broker", "wealthsimple");

          const res = await api.imports.createReview(formData);
          setStagedBatch(res);
          const totalRows = res.rows?.length || 0;
          const newRows = res.new_rows !== undefined ? res.new_rows : (res.rows ? res.rows.filter((r) => !r.is_duplicate).length : totalRows);
          const dupRows = totalRows - newRows;
          if (dupRows > 0) {
            setNotice(
              `Parsed ${totalRows} transactions from ${res.files_count || files.length} document(s) (${newRows} new, ${dupRows} duplicates identified). Review staged rows below before committing.`
            );
          } else {
            setNotice(`Parsed ${totalRows} transactions from ${res.files_count || files.length} document(s) ready for review.`);
          }
        }
      }
    } catch (err) {
      setError(err.message || "Failed to process import document(s).");
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCommitBatch = async () => {
    if (!stagedBatch?.batch_id) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.imports.commitReview(stagedBatch.batch_id);
      const committed = res.committed_rows ?? res.inserted ?? 0;
      const skipped = res.skipped_duplicates ?? res.skipped_existing ?? res.skipped ?? 0;
      if (skipped > 0) {
        setNotice(`Committed ${committed} new trade(s) to ACB ledger (${skipped} duplicate(s) skipped).`);
      } else {
        setNotice(`Committed ${committed} transaction(s) to ACB ledger.`);
      }
      setStagedBatch(null);
      setLastImportCategory("acb");
    } catch (err) {
      setError(err.message || "Failed to commit staged batch.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStagedRow = async (rowId) => {
    try {
      await api.imports.deleteReviewRow(rowId);
      setStagedBatch({
        ...stagedBatch,
        rows: stagedBatch.rows.filter((r) => r.id !== rowId),
      });
      setNotice("Removed row from staging batch.");
    } catch (err) {
      setError(err.message || "Failed to remove staged row.");
    }
  };

  const handleBackupUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!window.confirm("WARNING: Restoring a full database backup will overwrite existing records. Proceed?")) return;

    setLoading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await api.imports.importBackup(formData);
      setNotice(`Database backup restored successfully. ${res.details || ""}`);
    } catch (err) {
      setError(err.message || "Failed to restore backup snapshot.");
    } finally {
      setLoading(false);
      if (backupInputRef.current) backupInputRef.current.value = "";
    }
  };

  return (
    <div>
      {/* Top Bar */}
      <div className="top-bar">
        <div>
          <p className="eyebrow">DATA PORTABILITY & ONBOARDING</p>
          <h1>Import Wizard & Statement Hub</h1>
          <p>
            Centralized import portal for Wealthsimple activity statements, Rogers credit records, CRA registered files, and complete database archives.
          </p>
        </div>

        <div className="tabs" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className={`tab-btn ${activeTab === "wizard" ? "active" : ""}`}
            onClick={() => setActiveTab("wizard")}
          >
            Import Wizard
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "backup" ? "active" : ""}`}
            onClick={() => setActiveTab("backup")}
          >
            Database Backup & Export
          </button>
        </div>
      </div>

      {/* Notifications & Success Banners */}
      {error && <div className="error-banner" style={{ marginBottom: "1rem" }}>{error}</div>}
      {notice && (
        <div className="success-banner" style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <CheckCircle size={16} />
            <span>{notice}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {lastImportCategory && onNavigate && (
              <button
                type="button"
                className="link"
                style={{ fontWeight: 700, textDecoration: "underline" }}
                onClick={() => onNavigate(lastImportCategory)}
              >
                View in {lastImportCategory.replace("-", " ").toUpperCase()} →
              </button>
            )}
            <button type="button" className="link" onClick={() => setNotice("")}>Dismiss</button>
          </div>
        </div>
      )}

      {/* Friendly Co-Pilot Explainer */}
      <div className="friendly-explainer">
        <div className="friendly-explainer-icon">📥</div>
        <div>
          <h4 className="friendly-explainer-title">Unified Statement Ingestion Engine</h4>
          <p className="friendly-explainer-text">
            FinGlass provides native support for <strong>Wealthsimple custom activity statements</strong> across Chequing, Credit Cards, and Non-Registered Trade ACB tracking. Rogers Bank Mastercard statements and CRA Tax Shelters (TFSA, RRSP, FHSA) are also fully integrated. Automatic duplicate detection ensures identical transactions are never double-counted.
          </p>
        </div>
      </div>

      {activeTab === "wizard" ? (
        <>
          {/* Staged Review View (if reviewing investment ACB trades) */}
          {stagedBatch ? (
            <section className="panel" style={{ padding: 0, overflow: "hidden", marginBottom: "1.5rem" }}>
              <div className="panel-header" style={{ padding: "1.25rem 1.5rem" }}>
                <div>
                  <h3 style={{ margin: 0 }}>Review Staged Import ({stagedBatch.rows?.length || 0} rows)</h3>
                  <span className="fine">Verify transaction data before writing to ledger. Duplicate rows are recognized automatically.</span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setStagedBatch(null)}
                  >
                    Discard Batch
                  </button>
                  {(() => {
                    const newRowsCount = Array.isArray(stagedBatch?.rows) ? stagedBatch.rows.filter((r) => !r.is_duplicate).length : 0;
                    return (
                      <button
                        type="button"
                        disabled={loading || newRowsCount === 0}
                        onClick={handleCommitBatch}
                      >
                        <CheckCircle size={15} />
                        {newRowsCount > 0 ? `Commit ${newRowsCount} New Trade${newRowsCount === 1 ? "" : "s"} to Ledger` : "All Transactions Already in Ledger"}
                      </button>
                    );
                  })()}
                </div>
              </div>

              {stagedBatch.warnings && stagedBatch.warnings.length > 0 && (
                <div style={{ margin: "0.5rem 1.5rem 1rem", padding: "0.75rem 1rem", background: "rgba(234, 179, 8, 0.1)", border: "1px solid rgba(234, 179, 8, 0.3)", borderRadius: "8px", fontSize: "0.85rem", color: "#fef08a" }}>
                  {stagedBatch.warnings.map((w, idx) => (
                    <div key={idx} style={{ marginBottom: idx < stagedBatch.warnings.length - 1 ? "0.35rem" : 0 }}>
                      ⚠️ {w}
                    </div>
                  ))}
                </div>
              )}

              <div className="table-wrap" style={{ border: "none" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Security</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th className="num">Shares</th>
                      <th className="num">Price/Share</th>
                      <th className="num">Commission</th>
                      <th className="num">Total Amount</th>
                      <th style={{ textAlign: "center" }}>Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(stagedBatch?.rows) ? stagedBatch.rows : []).map((row) => (
                      <tr key={row.id}>
                        <td className="mono">{formatDate(row.trade_date)}</td>
                        <td><strong className="mono">{row.security}</strong></td>
                        <td><span className="status info">{row.transaction_type}</span></td>
                        <td>
                          {row.is_duplicate ? (
                            <span className="status warning" style={{ fontSize: "0.75rem" }} title={row.duplicate_reason === "already_in_ledger" ? "Matching transaction already exists in your ledger" : "Duplicate from another uploaded document"}>
                              {row.duplicate_reason === "already_in_ledger" ? "In Ledger" : "Duplicate"}
                            </span>
                          ) : (
                            <span className="status success" style={{ fontSize: "0.75rem" }}>New</span>
                          )}
                        </td>
                        <td className="num">{Number(row.shares || 0).toFixed(4)}</td>
                        <td className="num">${Number(row.amount_per_share || 0).toFixed(4)}</td>
                        <td className="num">{Number(row.commission || 0) > 0 ? formatMoney(row.commission) : "-"}</td>
                        <td className="num font-bold">{formatMoney(row.amount)}</td>
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className="link destructive"
                            onClick={() => handleDeleteStagedRow(row.id)}
                            title="Remove row"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* Statement Category Selector */}
          <section className="panel" style={{ marginBottom: "1.5rem" }}>
            <div className="panel-header">
              <h3>Choose Statement Type</h3>
              <span className="status info">Native Wealthsimple & Rogers Integration</span>
            </div>
            <p className="fine" style={{ marginBottom: "1.25rem" }}>
              Select the account category or statement format you are importing. FinGlass will automatically parse transaction dates, descriptions, categories, and amounts into the appropriate account ledger.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <button
                type="button"
                className={`tab-btn ${activeCategory === "auto" ? "active" : ""}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem", padding: "1rem 0.75rem", height: "auto", textAlign: "center" }}
                onClick={() => setActiveCategory("auto")}
              >
                <Sparkles size={20} color={activeCategory === "auto" ? "#38bdf8" : "#94a3b8"} />
                <strong style={{ fontSize: "0.95rem" }}>Auto-Detect</strong>
                <span className="fine" style={{ fontSize: "0.75rem", lineHeight: 1.2 }}>Smart dropzone for any document</span>
              </button>

              <button
                type="button"
                className={`tab-btn ${activeCategory === "chequing" ? "active" : ""}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem", padding: "1rem 0.75rem", height: "auto", textAlign: "center" }}
                onClick={() => setActiveCategory("chequing")}
              >
                <Building2 size={20} color={activeCategory === "chequing" ? "#38bdf8" : "#94a3b8"} />
                <strong style={{ fontSize: "0.95rem" }}>Chequing</strong>
                <span className="fine" style={{ fontSize: "0.75rem", lineHeight: 1.2 }}>Wealthsimple Cash Flow</span>
              </button>

              <button
                type="button"
                className={`tab-btn ${activeCategory === "credit" ? "active" : ""}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem", padding: "1rem 0.75rem", height: "auto", textAlign: "center" }}
                onClick={() => setActiveCategory("credit")}
              >
                <CreditCard size={20} color={activeCategory === "credit" ? "#38bdf8" : "#94a3b8"} />
                <strong style={{ fontSize: "0.95rem" }}>Credit Cards</strong>
                <span className="fine" style={{ fontSize: "0.75rem", lineHeight: 1.2 }}>Wealthsimple & Rogers Bank</span>
              </button>

              <button
                type="button"
                className={`tab-btn ${activeCategory === "acb" ? "active" : ""}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem", padding: "1rem 0.75rem", height: "auto", textAlign: "center" }}
                onClick={() => setActiveCategory("acb")}
              >
                <TrendingUp size={20} color={activeCategory === "acb" ? "#38bdf8" : "#94a3b8"} />
                <strong style={{ fontSize: "0.95rem" }}>ACB & Trades</strong>
                <span className="fine" style={{ fontSize: "0.75rem", lineHeight: 1.2 }}>Non-Reg Activities & Tax Slips</span>
              </button>

              <button
                type="button"
                className={`tab-btn ${activeCategory === "holdings" ? "active" : ""}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem", padding: "1rem 0.75rem", height: "auto", textAlign: "center" }}
                onClick={() => setActiveCategory("holdings")}
              >
                <PieChart size={20} color={activeCategory === "holdings" ? "#38bdf8" : "#94a3b8"} />
                <strong style={{ fontSize: "0.95rem" }}>Holdings Snapshot</strong>
                <span className="fine" style={{ fontSize: "0.75rem", lineHeight: 1.2 }}>Live positions & book values</span>
              </button>

              <button
                type="button"
                className={`tab-btn ${activeCategory === "registered" ? "active" : ""}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem", padding: "1rem 0.75rem", height: "auto", textAlign: "center" }}
                onClick={() => setActiveCategory("registered")}
              >
                <ShieldCheck size={20} color={activeCategory === "registered" ? "#38bdf8" : "#94a3b8"} />
                <strong style={{ fontSize: "0.95rem" }}>CRA Shelters</strong>
                <span className="fine" style={{ fontSize: "0.75rem", lineHeight: 1.2 }}>TFSA, RRSP, FHSA</span>
              </button>
            </div>

            {/* Category Configuration Panels */}
            {activeCategory === "auto" && (
              <div style={{ background: "var(--bg-card)", padding: "1.25rem", borderRadius: "8px", border: "1px dashed var(--border-panel)", marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <Sparkles size={16} color="#38bdf8" />
                  <strong style={{ fontSize: "0.95rem" }}>Auto-Detect Intelligent Uploader</strong>
                </div>
                <p className="fine" style={{ margin: 0 }}>
                  Upload any supported Wealthsimple CSV (Chequing, Credit, Trade Activities, Holdings) or Rogers Bank statement. FinGlass will automatically inspect document headers and route transactions to the correct account ledger.
                </p>
              </div>
            )}

            {activeCategory === "chequing" && (
              <div style={{ background: "var(--bg-card)", padding: "1.25rem", borderRadius: "8px", border: "1px solid var(--border-panel)", marginBottom: "1.5rem" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Building2 size={16} color="#38bdf8" /> Wealthsimple Chequing Configuration
                </h4>
                <p className="fine" style={{ marginBottom: "1rem" }}>
                  Upload custom activities statement export from Wealthsimple Chequing (<code>chequing-activities-*.csv</code>). Assign all incoming transactions to a named cash account:
                </p>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                  <label style={{ minWidth: "240px", flex: 1 }}>
                    Target Account Label
                    <select
                      value={chequingLabel}
                      onChange={(e) => setChequingLabel(e.target.value)}
                    >
                      {chequingAccounts.map((acc) => (
                        <option key={acc} value={acc}>{acc}</option>
                      ))}
                      <option value="__new__">+ Create New Account Label...</option>
                    </select>
                  </label>

                  {chequingLabel === "__new__" && (
                    <label style={{ minWidth: "220px", flex: 1 }}>
                      New Account Label Name
                      <input
                        type="text"
                        placeholder="e.g. Main Chequing, Joint Account"
                        value={customChequingLabel}
                        onChange={(e) => setCustomChequingLabel(e.target.value)}
                        autoFocus
                      />
                    </label>
                  )}
                </div>
              </div>
            )}

            {activeCategory === "credit" && (
              <div style={{ background: "var(--bg-card)", padding: "1.25rem", borderRadius: "8px", border: "1px solid var(--border-panel)", marginBottom: "1.5rem" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <CreditCard size={16} color="#38bdf8" /> Credit Card Statement Configuration
                </h4>
                <p className="fine" style={{ marginBottom: "1rem" }}>
                  Supports custom activity exports from Wealthsimple Credit (<code>card-activities-*.csv</code>) and Rogers Bank Mastercard CSV statements.
                </p>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                  <label style={{ minWidth: "180px" }}>
                    Statement Provider
                    <select
                      value={creditProvider}
                      onChange={(e) => setCreditProvider(e.target.value)}
                    >
                      <option value="auto">Auto-detect Provider</option>
                      <option value="wealthsimple">Wealthsimple Credit Card</option>
                      <option value="rogers">Rogers Bank Mastercard</option>
                    </select>
                  </label>

                  <label style={{ minWidth: "220px", flex: 1 }}>
                    Card Label
                    <select
                      value={cardLabel}
                      onChange={(e) => setCardLabel(e.target.value)}
                    >
                      {creditCards.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                      <option value="__new__">+ Create New Card Label...</option>
                    </select>
                  </label>

                  {cardLabel === "__new__" && (
                    <label style={{ minWidth: "200px", flex: 1 }}>
                      New Card Label Name
                      <input
                        type="text"
                        placeholder="e.g. Wealthsimple Visa, Rogers MC"
                        value={customCardLabel}
                        onChange={(e) => setCustomCardLabel(e.target.value)}
                        autoFocus
                      />
                    </label>
                  )}
                </div>
              </div>
            )}

            {activeCategory === "acb" && (
              <div style={{ background: "var(--bg-card)", padding: "1.25rem", borderRadius: "8px", border: "1px solid var(--border-panel)", marginBottom: "1.5rem" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <TrendingUp size={16} color="#38bdf8" /> Capital Gains & ACB Staging Configuration
                </h4>
                <p className="fine" style={{ marginBottom: "1rem" }}>
                  Upload Wealthsimple Trade Non-Registered Activity CSV (<code>activities-export-*.csv</code>) or CRA/Wealthsimple Tax PDF slip (T3, T5008). Registered account trades (TFSA, RRSP, FHSA) are automatically excluded to preserve non-taxable cost base accuracy.
                </p>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <label style={{ minWidth: "260px" }}>
                    Import Review Workflow
                    <select
                      value={acbMode}
                      onChange={(e) => setAcbMode(e.target.value)}
                    >
                      <option value="staged">Interactive Staged Review (Inspect rows & duplicates first)</option>
                      <option value="direct">Direct Ledger Commit (Fast import without staging)</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            {activeCategory === "holdings" && (
              <div style={{ background: "var(--bg-card)", padding: "1.25rem", borderRadius: "8px", border: "1px solid var(--border-panel)", marginBottom: "1.5rem" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <PieChart size={16} color="#38bdf8" /> Wealthsimple Holdings Report
                </h4>
                <p className="fine" style={{ margin: 0 }}>
                  Upload your comprehensive Wealthsimple Holdings report (<code>holdings-*.csv</code>). Overwrites the current portfolio snapshot with up-to-date position quantities, current market prices, book value in CAD, and total market values.
                </p>
              </div>
            )}

            {activeCategory === "registered" && (
              <div style={{ background: "var(--bg-card)", padding: "1.25rem", borderRadius: "8px", border: "1px solid var(--border-panel)", marginBottom: "1.5rem" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <ShieldCheck size={16} color="#38bdf8" /> CRA Registered Tax Shelters
                </h4>
                <p className="fine" style={{ marginBottom: "1rem" }}>
                  Select the registered account you wish to update with deposit, withdrawal, and CRA annual room logs:
                </p>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <label style={{ minWidth: "240px" }}>
                    Registered Account Type
                    <select
                      value={registeredType}
                      onChange={(e) => setRegisteredType(e.target.value)}
                    >
                      <option value="tfsa">TFSA &mdash; Tax-Free Savings Account</option>
                      <option value="rrsp">RRSP &mdash; Registered Retirement Savings Plan</option>
                      <option value="fhsa">FHSA &mdash; First Home Savings Account</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            {/* Hidden File Input & Upload Trigger */}
            <input
              type="file"
              ref={fileInputRef}
              accept={activeCategory === "acb" || activeCategory === "auto" ? ".csv,.pdf" : ".csv"}
              multiple={activeCategory !== "holdings" && activeCategory !== "registered"}
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />

            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={loading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={16} />
                {loading ? "Processing Document(s)..." : `Select ${activeCategory === "acb" || activeCategory === "auto" ? "File(s) (CSV or PDF)" : "CSV File(s)"} to Import`}
              </button>

              <span className="fine" style={{ color: "var(--text-quiet)" }}>
                {activeCategory === "holdings" || activeCategory === "registered"
                  ? "Single file upload"
                  : "Multi-file batch upload supported"}
              </span>
            </div>
          </section>
        </>
      ) : (
        /* Database Backup & Full Export Section */
        <>
          <section className="panel stack">
            <div className="panel-header">
              <h3>Complete Portfolio Data Export</h3>
            </div>
            <p className="fine">
              Download your entire financial database archive, including all investment trades, ACB history, credit card receipts, chequing flows, and registered contribution logs.
            </p>

            <div>
              <a
                href="/api/export/all"
                download="finglass_full_export.zip"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1.25rem", borderRadius: "9px", background: "var(--accent)", color: "var(--accent-text)", fontWeight: 800 }}
              >
                <Download size={16} />
                Download Full Archive (.ZIP)
              </a>
            </div>
          </section>

          <section className="panel stack">
            <div className="panel-header">
              <h3>Restore Database from Backup</h3>
            </div>
            <div className="notice" style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <AlertTriangle size={20} color="#ffd391" />
              <span>
                <strong>Warning:</strong> Restoring from a backup snapshot will replace existing records. Ensure your backup file matches FinGlass schema requirements.
              </span>
            </div>

            <input
              type="file"
              ref={backupInputRef}
              accept=".zip,.json,.sqlite3,.db"
              style={{ display: "none" }}
              onChange={handleBackupUpload}
            />

            <div>
              <button
                type="button"
                className="danger"
                disabled={loading}
                onClick={() => backupInputRef.current?.click()}
              >
                <Upload size={16} />
                {loading ? "Restoring Archive..." : "Select Backup File & Overwrite"}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
