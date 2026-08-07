import type { CSSProperties } from "react";

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { maxWidth: 760, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: { display: "flex", flexDirection: "column", gap: 8, padding: 14 } satisfies CSSProperties,
  rowTop: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  versionTag: { fontSize: 13, fontWeight: 700 } satisfies CSSProperties,
  summary: { fontSize: 13, color: "var(--text-secondary)", flex: 1 } satisfies CSSProperties,
  date: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  actions: { display: "flex", gap: 8, marginLeft: "auto" } satisfies CSSProperties,
  diffPanel: {
    marginTop: 4,
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
