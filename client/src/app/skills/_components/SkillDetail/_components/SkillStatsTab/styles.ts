import type { CSSProperties } from "react";

/** Co-located styles for SkillStatsTab. */
export const s = {
  wrap: { maxWidth: 760, display: "flex", flexDirection: "column", gap: 24 } satisfies CSSProperties,
  tiles: { display: "flex", gap: 12 } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  agentList: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  agentName: { flex: 1, fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  agentLink: { fontSize: 12, color: "var(--accent)", textDecoration: "none" } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
