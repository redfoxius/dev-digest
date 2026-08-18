import type { CSSProperties } from "react";

export const s = {
  emptyText: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  statRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 14,
  } satisfies CSSProperties,
  topSymbolBox: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  topSymbolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  symbolName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    flexShrink: 0,
  } satisfies CSSProperties,
  callerCount: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  callerList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    background: "none",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    padding: "3px 0",
  } satisfies CSSProperties,
  callerLink: {
    fontSize: 12,
    color: "var(--link)",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  callerName: {
    fontSize: 12,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  moreCallers: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic",
    padding: "3px 0 0 20px",
  } satisfies CSSProperties,
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } satisfies CSSProperties,
} as const;
