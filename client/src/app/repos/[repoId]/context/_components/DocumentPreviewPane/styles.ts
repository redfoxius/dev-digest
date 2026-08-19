import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    height: "100%",
  } satisfies CSSProperties,
  path: {
    fontSize: 12,
    color: "var(--text-muted)",
    paddingBottom: 8,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  body: {
    flex: 1,
    overflow: "auto",
  } satisfies CSSProperties,
  loadingStack: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
} as const;
