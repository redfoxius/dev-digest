import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseModal. */
export const s = {
  body: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  row: { display: "flex", gap: 14 } satisfies CSSProperties,
  field: { flex: 1, marginBottom: 14 } satisfies CSSProperties,
  subTabPanel: { marginBottom: 16 } satisfies CSSProperties,
  errorText: { fontSize: 12, color: "var(--crit)", marginTop: 6, lineHeight: 1.4 } satisfies CSSProperties,
  statusLine: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 7,
    fontSize: 12.5,
    marginBottom: 14,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  footerActions: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
