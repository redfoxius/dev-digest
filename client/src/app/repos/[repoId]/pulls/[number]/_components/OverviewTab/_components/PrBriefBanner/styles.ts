import type { CSSProperties } from "react";

export const s = {
  emptyWrap: {
    display: "flex",
    alignItems: "center",
    padding: 18,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 14,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
