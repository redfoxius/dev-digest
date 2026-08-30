import type { CSSProperties } from "react";

export const s = {
  page: {
    padding: "24px 28px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 960,
  } as CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } as CSSProperties,
  h1: {
    fontSize: 18,
    fontWeight: 700,
  } as CSSProperties,
  alert: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 13,
    fontWeight: 500,
  } as CSSProperties,
  metricsRow: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
  } as CSSProperties,
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } as CSSProperties,
  h2: {
    fontSize: 14,
    fontWeight: 700,
  } as CSSProperties,
  emptyNote: {
    fontSize: 13,
    color: "var(--text-muted)",
  } as CSSProperties,
  legend: {
    display: "flex",
    gap: 16,
    fontSize: 12,
    color: "var(--text-secondary)",
  } as CSSProperties,
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } as CSSProperties,
  legendDot: (color: string): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: 99,
    background: color,
    display: "inline-block",
  }),
  tableWrap: {
    overflow: "auto",
  } as CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  } as CSSProperties,
  th: {
    textAlign: "left",
    padding: "8px 10px",
    color: "var(--text-muted)",
    fontWeight: 600,
    fontSize: 12,
    borderBottom: "1px solid var(--border)",
  } as CSSProperties,
  td: {
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text-secondary)",
  } as CSSProperties,
  compareRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } as CSSProperties,
  compareHint: {
    fontSize: 12,
    color: "var(--text-muted)",
  } as CSSProperties,
  // No shared srOnly utility exists in this codebase (client/INSIGHTS.md,
  // 2026-08-06 entry) — each styles.ts self-contains its own copy for a
  // per-checkbox accessible name that shouldn't also render visibly.
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  } as CSSProperties,
};
