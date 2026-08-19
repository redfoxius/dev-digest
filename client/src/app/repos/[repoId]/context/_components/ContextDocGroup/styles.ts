import type { CSSProperties } from "react";

export const s = {
  group: {
    marginBottom: 18,
  } satisfies CSSProperties,
  heading: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    padding: "4px 12px",
  } satisfies CSSProperties,
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
} as const;
