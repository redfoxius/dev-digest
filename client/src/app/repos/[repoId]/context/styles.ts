import type { CSSProperties } from "react";

/** Co-located styles for the Project Context page — mirrors
   conventions/styles.ts's token shapes, plus a two-column
   list/preview split (`body`/`list`/`preview`) this route needs and
   conventions doesn't. */
export const s = {
  pageHeader: {
    padding: "24px 32px 10px",
    display: "flex",
    alignItems: "flex-end",
    gap: 16,
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  pageSubtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    marginTop: 4,
  } satisfies CSSProperties,
  headerActions: {
    marginLeft: "auto",
    display: "flex",
    gap: 10,
    alignItems: "center",
  } satisfies CSSProperties,
  toolbar: {
    margin: "0 32px 14px",
    display: "flex",
    alignItems: "center",
    gap: 14,
  } satisfies CSSProperties,
  statusLine: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  body: {
    margin: "0 32px 44px",
    display: "flex",
    gap: 24,
    alignItems: "flex-start",
  } satisfies CSSProperties,
  list: {
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  preview: {
    flex: 1,
    minWidth: 0,
    minHeight: 360,
    padding: 16,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    position: "sticky",
    top: 16,
  } satisfies CSSProperties,
  loadingStack: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
} as const;
