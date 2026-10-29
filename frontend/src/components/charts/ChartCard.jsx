import React from "react";

export function ChartCard({
  title,
  subtitle,
  badge,
  action,
  height = 260,
  empty = false,
  emptyMessage = "No data available to display.",
  children,
  className = "",
  style = {},
}) {
  return (
    <div
      className={`chart-card ${className}`}
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border-panel)",
        borderRadius: "var(--radius-lg)",
        padding: "1.25rem",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.18)",
        minWidth: 0,
        ...style,
      }}
    >
      <div
        className="chart-card-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1rem",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <h4
              style={{
                margin: 0,
                fontSize: "1rem",
                fontWeight: 700,
                color: "var(--text-main)",
                letterSpacing: "-0.01em",
              }}
            >
              {title}
            </h4>
            {badge && (
              <span
                style={{
                  fontSize: "0.72rem",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "var(--radius-pill)",
                  background: "rgba(56, 189, 248, 0.12)",
                  color: "var(--accent)",
                  fontWeight: 600,
                  border: "1px solid rgba(56, 189, 248, 0.25)",
                }}
              >
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.8rem",
                color: "var(--text-muted)",
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {action && <div>{action}</div>}
      </div>

      <div
        className="chart-card-body"
        style={{
          height: `${height}px`,
          position: "relative",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 0,
        }}
      >
        {empty ? (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-fine)",
              fontSize: "0.88rem",
              padding: "1rem",
            }}
          >
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
