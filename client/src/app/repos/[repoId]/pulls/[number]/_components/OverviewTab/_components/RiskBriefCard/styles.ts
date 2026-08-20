import type { CSSProperties } from "react";

export const s = {
  riskLevelRow: {
    marginBottom: 10,
  } satisfies CSSProperties,
  whatText: {
    fontSize: 14,
    color: "var(--text-primary)",
    lineHeight: 1.55,
    marginBottom: 6,
  } satisfies CSSProperties,
  whyText: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  /** Divider wrapper for a labeled subsection inside the card — mirrors
   *  `IntentCard/styles.ts`'s own `subsection` entry (this codebase's
   *  established idiom for a bordered section break inside one `Card`). */
  subsection: {
    marginTop: 14,
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  riskRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  } satisfies CSSProperties,
  emptyBullet: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  focusList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  focusRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    width: "100%",
    background: "none",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    padding: "4px 0",
  } satisfies CSSProperties,
  focusLocation: {
    fontSize: 12.5,
    color: "var(--link)",
    flexShrink: 0,
  } satisfies CSSProperties,
  focusReason: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.4,
  } satisfies CSSProperties,
} as const;
