import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab. Mirrors SkillStatsTab's `tiles` shape for
   the summary cards, and SkillsTab/ContextTab's `list`/`row` shape for the
   per-case rows. */
export const s = {
  wrap: { maxWidth: 860, display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700, marginRight: "auto" } satisfies CSSProperties,
  tiles: { display: "flex", gap: 12 } satisfies CSSProperties,
  alert: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
  } satisfies CSSProperties,
  list: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  name: { fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0 } satisfies CSSProperties,
  counts: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  actions: { display: "flex", gap: 2, flexShrink: 0 } satisfies CSSProperties,
  empty: {
    padding: "24px 14px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
} as const;
