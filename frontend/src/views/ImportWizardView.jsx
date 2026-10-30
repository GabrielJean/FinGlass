import React, { useState, useRef } from "react";
import { api } from "../api";
import { formatMoney, formatDate } from "../utils/formatters";
import {
  Upload,
  Download,
  FileText,
  CheckCircle,
  AlertTriangle,
  Database,
  ArrowRight,
  Trash2,
} from "lucide-react";

export function ImportWizardView() {
  const [activeTab, setActiveTab] = useState("wizard"); // 'wizard' | 'backup'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Staged review state
  const [stagedBatch, setStagedBatch] = useState(null);
  const [importType, setImportType] = useState("activities_csv"); // 'activities_csv' | 'tax_pdf'
  const fileInputRef = useRef(null);
  const backupInputRef = useRef(null);

  const handleUploadStaged = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError("");
    setNotice("");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("import_type", importType);
    formData.append("source_type", importType);
    formData.append("broker", "wealthsimple");

    try {
      const res = await api.imports.createReview(formData);
      setStagedBatch(res);
      setNotice(`Parsed ${res.rows?.length || 0} rows ready for review.`);
    } catch (err) {
      setError(err.message || "Failed to parse import file.");
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
      setNotice(`Committed ${res.committed_rows || stagedBatch.rows?.length} transactions to ledger.`);
      setStagedBatch(null);
    } catch (err) {
      setError(err.message || "Failed to commit batch.");
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
      setNotice("Row removed from batch.");
    } catch (err) {
      setError(err.message || "Failed to remove row.");
    }
  };

  const handleBackupUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!window.confirm("WARNING: Restoring a backup will overwrite current database records. Proceed?")) return;

    setLoading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await api.imports.importBackup(formData);
      setNotice(`Backup restored successfully. ${res.details || ""}`);
    } catch (err) {
      setError(err.message || "Failed to restore backup.");
    } finally {
      setLoading(false);
      if (backupInputRef.current) backupInputRef.current.value = "";
    }
  };

  return (
    <div>
      <div className="top-bar">
        <div>
          <p className="eyebrow">DATA PORTABILITY & ONBOARDING</p>
          <h1>Import Wizard & Backup</h1>
          <p>
            Staged Wealthsimple statements review, direct CSV imports, and complete system backup snapshots.
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

      {error && <div className="error-banner" style={{ marginBottom: "1rem" }}>{error}</div>}
      {notice && (
        <div className="success-banner" style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between" }}>
          <span>{notice}</span>
          <button type="button" className="link" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      {/* Friendly Co-Pilot Explainer */}
      <div className="friendly-explainer">
        <div className="friendly-explainer-icon">📥</div>
        <div>
          <h4 className="friendly-explainer-title">Statement Staging & Review</h4>
          <p className="friendly-explainer-text">
            Easily load your transactions from Wealthsimple! When you upload an Activities CSV or Tax PDF, you get to <strong>review and verify everything first</strong> before anything gets permanently added to your accounts. Nothing changes until you give the green light.
          </p>
        </div>
      </div>

      {activeTab === "wizard" ? (
        <>
          {/* Staged Review Section */}
          {!stagedBatch ? (
            <section className="panel">
              <div className="panel-header">
                <h3>Wealthsimple Activity & Tax Statement Staging</h3>
                <span className="status info">Wealthsimple Exclusive Support</span>
              </div>
              <p className="fine" style={{ marginBottom: "0.75rem" }}>
                Upload your Wealthsimple Activities CSV or official Wealthsimple Tax slip PDF. Transactions will be parsed into an interactive staging table where you can inspect, edit, and verify rows before committing them to your permanent ledger.
              </p>
              <div className="signal" style={{ marginBottom: "1.5rem", padding: "0.45rem 0.8rem", fontSize: "0.8rem", width: "fit-content" }}>
                <span></span> Note: FinGlass exclusively supports Wealthsimple for statement imports. Historical data from previously imported brokers is preserved.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", maxWidth: "600px", marginBottom: "1.5rem" }}>
                <label>
                  Statement Source Type
                  <select
                    value={importType}
                    onChange={(e) => setImportType(e.target.value)}
                  >
                    <option value="activities_csv">Wealthsimple Activities CSV</option>
                    <option value="tax_pdf">Wealthsimple / CRA Tax Slip PDF</option>
                  </select>
                </label>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                accept={importType === "tax_pdf" ? ".pdf" : ".csv"}
                style={{ display: "none" }}
                onChange={handleUploadStaged}
              />

              <button
                type="button"
                disabled={loading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={16} />
                {loading ? "Parsing File..." : `Select ${importType === "tax_pdf" ? "PDF" : "CSV"} & Review`}
              </button>
            </section>
          ) : (
            /* Review Staged Rows */
            <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
              <div className="panel-header" style={{ padding: "1.25rem 1.5rem" }}>
                <div>
                  <h3 style={{ margin: 0 }}>Review Staged Import ({stagedBatch.rows?.length || 0} rows)</h3>
                  <span className="fine">Verify transaction data before writing to ledger.</span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setStagedBatch(null)}
                  >
                    Discard Batch
                  </button>
                  <button
                    type="button"
                    disabled={loading || !stagedBatch.rows?.length}
                    onClick={handleCommitBatch}
                  >
                    <CheckCircle size={15} />
                    Commit Batch to Ledger
                  </button>
                </div>
              </div>

              <div className="table-wrap" style={{ border: "none" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Security</th>
                      <th>Type</th>
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
          )}

          {/* Sample CSV Download Templates */}
          <section className="panel">
            <div className="panel-header">
              <h3>Sample CSV Templates</h3>
            </div>
            <p className="fine" style={{ marginBottom: "1rem" }}>
              Download official CSV formatting templates to prepare transaction imports manually.
            </p>

            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <a
                href="/static/tfsa_import_sample.csv"
                download="tfsa_import_sample.csv"
                className="secondary"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1rem", borderRadius: "9px", background: "#17273f", border: "1px solid var(--border-panel)", color: "#d8e5f8", fontSize: "0.85rem", fontWeight: 700 }}
              >
                <Download size={14} />
                TFSA Sample Template
              </a>
              <a
                href="/static/rrsp_import_sample.csv"
                download="rrsp_import_sample.csv"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1rem", borderRadius: "9px", background: "#17273f", border: "1px solid var(--border-panel)", color: "#d8e5f8", fontSize: "0.85rem", fontWeight: 700 }}
              >
                <Download size={14} />
                RRSP Sample Template
              </a>
              <a
                href="/static/fhsa_import_sample.csv"
                download="fhsa_import_sample.csv"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.6rem 1rem", borderRadius: "9px", background: "#17273f", border: "1px solid var(--border-panel)", color: "#d8e5f8", fontSize: "0.85rem", fontWeight: 700 }}
              >
                <Download size={14} />
                FHSA Sample Template
              </a>
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

