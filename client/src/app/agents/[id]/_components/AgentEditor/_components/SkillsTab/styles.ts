import type { CSSProperties } from "react";

/** Co-located styles for SkillsTab. */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  filter: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    width: 200,
  } satisfies CSSProperties,
  filterIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filterInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.45 } satisfies CSSProperties,
  list: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  row: (dragOver: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    background: dragOver ? "var(--bg-hover)" : "transparent",
  }),
  handle: { display: "flex", cursor: "grab", color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  name: { fontSize: 13, flex: 1, minWidth: 0 } satisfies CSSProperties,
  vetting: { fontSize: 11, color: "var(--warn)", display: "flex", alignItems: "center", gap: 4 } satisfies CSSProperties,
  empty: { padding: "24px 14px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
} as const;
