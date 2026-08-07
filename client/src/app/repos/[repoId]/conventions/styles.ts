import type { CSSProperties } from "react";

/** Co-located styles for the Conventions page — mirrors pulls/styles.ts tokens. */
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
  counter: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  toolbarRight: {
    marginLeft: "auto",
  } satisfies CSSProperties,
  list: {
    margin: "0 32px 44px",
  } satisfies CSSProperties,
  loadingStack: {
    margin: "0 32px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
} as const;
