import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    width: "100%",
    textAlign: "left",
    padding: "14px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    cursor: "pointer",
  } as CSSProperties,
  identity: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 220,
  } as CSSProperties,
  name: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } as CSSProperties,
  metrics: {
    display: "flex",
    alignItems: "center",
    gap: 18,
    flex: 1,
    flexWrap: "wrap",
  } as CSSProperties,
  metric: {
    fontSize: 13,
    color: "var(--text-secondary)",
    display: "inline-flex",
    gap: 5,
  } as CSSProperties,
  tracesBadge: {
    fontSize: 12,
    color: "var(--text-muted)",
  } as CSSProperties,
};
