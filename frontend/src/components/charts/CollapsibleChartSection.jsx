import React, { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, BarChart3 } from "lucide-react";

export function CollapsibleChartSection({
  title = "Analytics & Visualizations",
  subtitle = "Interactive charts and trends",
  icon: Icon = BarChart3,
  storageKey,
  defaultOpen = true,
  chartCount,
  children,
  style = {},
}) {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window !== "undefined" && storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        return stored === "true";
      }
    }
    return defaultOpen;
  });

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (typeof window !== "undefined" && storageKey) {
      localStorage.setItem(storageKey, String(next));
    }
  };

  return (
    <section
      className={`collapsible-charts-container ${isOpen ? "is-open" : "is-collapsed"}`}
      style={{
        marginBottom: "2rem",
        ...style,
      }}
    >
      <div
        className="collapsible-charts-header-card"
        style={{
          background: "linear-gradient(90deg, #101b2e 0%, #111e32 100%)",
          border: "1px solid var(--border-panel)",
          borderRadius: isOpen ? "var(--radius-lg) var(--radius-lg) 0 0" : "var(--radius-lg)",
          padding: "0.9rem 1.25rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          cursor: "pointer",
          userSelect: "none",
          transition: "border-color 0.15s ease, background 0.15s ease",
          boxShadow: "0 2px 10px rgba(0, 0, 0, 0.12)",
        }}
        onClick={toggle}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "34px",
              height: "34px",
              borderRadius: "var(--radius-md)",
              background: "rgba(56, 189, 248, 0.12)",
              color: "var(--accent)",
              border: "1px solid rgba(56, 189, 248, 0.25)",
            }}
          >
            <Icon size={18} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: "1.05rem",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  letterSpacing: "-0.01em",
                }}
              >
                {title}
              </h3>
              {chartCount !== undefined && (
                <span
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    padding: "0.15rem 0.5rem",
                    borderRadius: "var(--radius-pill)",
                    background: "rgba(255, 255, 255, 0.08)",
                    color: "var(--text-muted)",
                  }}
                >
                  {chartCount} {chartCount === 1 ? "graph" : "graphs"}
                </span>
              )}
              {!isOpen && (
                <span
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    padding: "0.15rem 0.5rem",
                    borderRadius: "var(--radius-pill)",
                    background: "rgba(245, 158, 11, 0.15)",
                    color: "var(--warning-text)",
                    border: "1px solid rgba(245, 158, 11, 0.25)",
                  }}
                >
                  Collapsed
                </span>
              )}
            </div>
            {subtitle && (
              <p
                style={{
                  margin: "0.2rem 0 0",
                  fontSize: "0.82rem",
                  color: "var(--text-muted)",
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className="secondary"
          style={{
            padding: "0.45rem 0.85rem",
            fontSize: "0.8rem",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            background: "var(--bg-input)",
            borderColor: "var(--border-input)",
          }}
        >
          {isOpen ? (
            <>
              <ChevronUp size={15} />
              <span>Hide Graphs</span>
            </>
          ) : (
            <>
              <ChevronDown size={15} />
              <span>Show Graphs</span>
            </>
          )}
        </button>
      </div>

      {isOpen && (
        <div
          className="collapsible-charts-content"
          style={{
            background: "rgba(10, 20, 36, 0.4)",
            border: "1px solid var(--border-panel)",
            borderTop: "none",
            borderRadius: "0 0 var(--radius-lg) var(--radius-lg)",
            padding: "1.5rem",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}
