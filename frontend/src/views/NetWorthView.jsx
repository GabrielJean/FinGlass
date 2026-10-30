import React, { useEffect, useState, useMemo } from "react";
import { api } from "../api";
import { formatMoney, formatDate } from "../utils/formatters";
import { Plus, Trash2, TrendingUp, Calendar } from "lucide-react";
import { Line } from "react-chartjs-2";
import "../components/charts/chartSetup";
import {
  formatCompactMoney,
  commonTooltipOptions,
  commonScaleOptions,
} from "../components/charts/chartSetup";
import { CollapsibleChartSection } from "../components/charts/CollapsibleChartSection";
import { ChartCard } from "../components/charts/ChartCard";

export function NetWorthView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState([]);

  // Modal
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().split("T")[0],
    amount: "",
    note: "",
  });

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.netWorth.getHistory();
      setHistory(Array.isArray(res) ? res : (res?.history || res?.rows || []));
    } catch (err) {
      setError(err.message || "Failed to load net worth history.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await api.netWorth.createEntry({
        entry_date: form.entry_date,
        amount: Number(form.amount),
        note: form.note,
      });
      setNotice("Net worth snapshot recorded.");
      setIsOpen(false);
      setForm({
        entry_date: new Date().toISOString().split("T")[0],
        amount: "",
        note: "",
      });
      loadData();
    } catch (err) {
      setError(err.message || "Failed to save entry.");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this net worth snapshot?")) return;
    try {
      await api.netWorth.deleteEntry(id);
      setNotice("Snapshot deleted.");
      loadData();
    } catch (err) {
      setError(err.message || "Failed to delete entry.");
    }
  };

  const sorted = [...(Array.isArray(history) ? history : [])].sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date));
  const latest = sorted[0];
  const previous = sorted[1];
  const diff = latest && previous ? Number(latest.amount) - Number(previous.amount) : 0;
  const diffPct = previous && Number(previous.amount) > 0 ? (diff / Number(previous.amount)) * 100 : 0;

  // Chronological order for chart
  const chartChronological = useMemo(() => {
    return [...(Array.isArray(history) ? history : [])].sort((a, b) =>
      a.entry_date.localeCompare(b.entry_date)
    );
  }, [history]);

  const chartData = useMemo(() => {
    return {
      labels: chartChronological.map((item) => formatDate(item.entry_date)),
      datasets: [
        {
          label: "Net Worth",
          data: chartChronological.map((item) => Number(item.amount || 0)),
          borderColor: "#34d399",
          backgroundColor: "rgba(52, 211, 153, 0.12)",
          fill: true,
          tension: 0.3,
          pointRadius: chartChronological.length > 25 ? 2 : 4,
          pointHoverRadius: 6,
          pointBackgroundColor: "#34d399",
          pointBorderColor: "#09111f",
          pointBorderWidth: 2,
        },
      ],
    };
  }, [chartChronological]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...commonTooltipOptions,
          callbacks: {
            label: (ctx) => `Net Worth: ${formatMoney(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: {
          ...commonScaleOptions,
          grid: { display: false },
        },
        y: {
          ...commonScaleOptions,
          ticks: {
            ...commonScaleOptions.ticks,
            callback: (value) => formatCompactMoney(value),
          },
        },
      },
    };
  }, []);

  return (
    <div>
      <div className="top-bar">
        <div>
          <p className="eyebrow">HISTORICAL WEALTH MILESTONES</p>
          <h1>Net Worth Tracker</h1>
          <p>Track your assets minus liabilities over time with periodic wealth snapshots.</p>
        </div>

        <button type="button" onClick={() => setIsOpen(true)}>
          <Plus size={15} />
          Record Snapshot
        </button>
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
        <div className="friendly-explainer-icon">📈</div>
        <div>
          <h4 className="friendly-explainer-title">How Net Worth is Calculated</h4>
          <p className="friendly-explainer-text">
            Your <strong>Net Worth</strong> is the truest measure of your financial progress: <strong>Everything You Own</strong> (investments, bank accounts, home) minus <strong>Everything You Owe</strong> (credit cards, loans, mortgages). Watching this number trend upwards over time is financial peace of mind.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Latest Recorded Net Worth</span>
          <span className="kpi-val" style={{ color: "var(--accent)" }}>
            {latest ? formatMoney(latest.amount) : "$0.00"}
          </span>
          <span className="kpi-sub">
            As of {latest ? formatDate(latest.entry_date) : "N/A"}
          </span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Change Since Prior Snapshot</span>
          <span className={`kpi-val ${diff >= 0 ? "text-positive" : "text-negative"}`}>
            {diff >= 0 ? `+${formatMoney(diff)}` : formatMoney(diff)}
          </span>
          <span className={`kpi-sub ${diff >= 0 ? "positive" : "negative"}`}>
            {diffPct ? `${diffPct.toFixed(2)}% period change` : "-"}
          </span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Snapshots Logged</span>
          <span className="kpi-val">{history.length}</span>
          <span className="kpi-sub">Lifetime timeline records</span>
        </div>
      </section>

      {/* Collapsible Net Worth Trajectory Chart */}
      <CollapsibleChartSection
        title="Net Worth Growth Trajectory"
        subtitle="Historical timeline and valuation milestone progression"
        storageKey="finglass_collapse_networth_chart"
        chartCount={1}
        icon={TrendingUp}
      >
        <ChartCard
          title="Historical Net Worth"
          subtitle="Assets minus liabilities valuation progression"
          badge={chartChronological.length ? `${chartChronological.length} snapshots` : undefined}
          height={300}
          empty={chartChronological.length === 0}
          emptyMessage="No snapshots recorded yet. Record your first snapshot to view your wealth curve."
        >
          {chartChronological.length > 0 && <Line data={chartData} options={chartOptions} />}
        </ChartCard>
      </CollapsibleChartSection>

      {/* History Table */}
      <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div className="panel-header" style={{ padding: "1.25rem 1.5rem 0.75rem" }}>
          <h3>Net Worth Progression</h3>
        </div>

        {loading ? (
          <div className="loading" style={{ minHeight: "200px" }}>Loading net worth data...</div>
        ) : sorted.length === 0 ? (
          <div className="empty">
            <h3>No net worth snapshots yet</h3>
            <p>Record your net worth snapshot periodically to visualize your wealth growth.</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ border: "none" }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Recorded Amount</th>
                  <th>Notes / Milestone</th>
                  <th style={{ textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => (
                  <tr key={item.id}>
                    <td className="mono">{formatDate(item.entry_date)}</td>
                    <td className="num font-bold" style={{ fontSize: "1rem" }}>
                      {formatMoney(item.amount)}
                    </td>
                    <td className="fine">{item.note || "-"}</td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        className="link destructive"
                        onClick={() => handleDelete(item.id)}
                        title="Delete snapshot"
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

      {/* Snapshot Modal */}
      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <p className="eyebrow">NEW WEALTH SNAPSHOT</p>
            <h2>Record Net Worth</h2>
            <form onSubmit={handleSave} className="stack">
              <div className="form-grid-2">
                <label>
                  <span>Net Worth Total (CAD)</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="e.g. 150000.00"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </label>

                <label>
                  <span>Snapshot Date</span>
                  <input
                    type="date"
                    required
                    value={form.entry_date}
                    onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
                  />
                </label>
              </div>

              <label>
                <span>Milestone Note (optional)</span>
                <input
                  type="text"
                  placeholder="e.g. Year-end financial review"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </label>

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setIsOpen(false)}>
                  Cancel
                </button>
                <button type="submit">Record Milestone</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

