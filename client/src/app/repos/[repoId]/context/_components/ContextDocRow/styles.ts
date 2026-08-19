import type { CSSProperties } from "react";

export const s = {
  row: (selected: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    textAlign: "left",
    padding: "9px 12px",
    borderRadius: 6,
    border: "1px solid transparent",
    background: selected ? "var(--bg-hover)" : "transparent",
    borderColor: selected ? "var(--border-strong)" : "transparent",
    cursor: "pointer",
  }),
  path: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  usedBy: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
