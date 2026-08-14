import type { CSSProperties } from "react";

export const s = {
  intentText: {
    fontSize: 14,
    color: "var(--text-primary)",
    lineHeight: 1.55,
    marginBottom: 14,
  } satisfies CSSProperties,
  columns: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
    marginBottom: 14,
  } satisfies CSSProperties,
  columnLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  bulletList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  bulletItem: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  emptyBullet: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  riskRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  } satisfies CSSProperties,
  /** Divider wrapper for a labeled subsection inside the card (Phase 3 —
   *  "PR BRIEF" redesign). Mirrors this codebase's established divider
   *  idiom (`FindingCard/styles.ts`'s `body` entry) — a `borderTop` rule
   *  applied directly to the section's own wrapper, no separate `<hr>`. */
  subsection: {
    marginTop: 14,
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
} as const;
