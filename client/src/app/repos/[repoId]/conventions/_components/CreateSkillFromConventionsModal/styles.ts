import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillFromConventionsModal. */
export const s = {
  // Modal's own content wrapper (kit/Modal.tsx) has zero padding by design —
  // every OTHER modal in the app (e.g. CreateAgentModal) wraps its content in
  // its own `padding: 24` div; this one didn't, so fields sat flush against
  // the modal's edges with no breathing room.
  body: { padding: 24 } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 16,
  } satisfies CSSProperties,
  field: { marginBottom: 14 } satisfies CSSProperties,
  row: { display: "flex", gap: 14, alignItems: "flex-end" } satisfies CSSProperties,
  editorFrame: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  editorTitleBar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
  } satisfies CSSProperties,
  tokenCount: {
    marginLeft: "auto",
    color: "var(--text-muted)",
    fontSize: 12,
  } satisfies CSSProperties,
  footerActions: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
