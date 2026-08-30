import type { CSSProperties } from "react";

/** Co-located styles for CompareRunsModal. */
export const s = {
  body: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "8px 10px",
    color: "var(--text-muted)",
    fontWeight: 600,
    fontSize: 12,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: {
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  deltaCell: (delta: number | null): CSSProperties => ({
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
    fontWeight: 700,
    color: delta == null || delta === 0 ? "var(--text-muted)" : delta > 0 ? "var(--ok)" : "var(--crit)",
  }),
  note: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  h3: { fontSize: 13, fontWeight: 700 } satisfies CSSProperties,
  diffPanel: {
    padding: 12,
    borderRadius: 7,
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    maxHeight: 320,
    overflow: "auto",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  diffLine: (type: "add" | "remove" | "same"): CSSProperties => ({
    whiteSpace: "pre-wrap",
    padding: "0 6px",
    background: type === "add" ? "var(--ok-bg)" : type === "remove" ? "var(--crit-bg)" : "transparent",
    color: type === "add" ? "var(--ok)" : type === "remove" ? "var(--crit)" : "var(--text-secondary)",
  }),
} as const;
