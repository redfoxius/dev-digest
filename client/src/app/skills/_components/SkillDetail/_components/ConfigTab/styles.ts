import type { CSSProperties } from "react";

/** Co-located styles for ConfigTab (shared by the SkillDetail Config tab and
   the standalone "+ New skill" blank-create view). */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 20 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  enabledLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  untrustedBanner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-primary)",
    marginBottom: 20,
  } satisfies CSSProperties,
  editorFieldRight: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  unsavedPill: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "1px 7px",
    borderRadius: 99,
    letterSpacing: "0.02em",
  } satisfies CSSProperties,
  editorFrame: {
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  editorTitleBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 12px",
    background: "var(--bg-elevated)",
    borderBottom: "1px solid var(--border)",
    fontSize: 12.5,
  } satisfies CSSProperties,
  editorFilename: { fontFamily: "var(--font-mono, monospace)", color: "var(--text-secondary)" } satisfies CSSProperties,
  actions: { display: "flex", gap: 10, marginTop: 10, alignItems: "center" } satisfies CSSProperties,
  savedNote: { alignSelf: "center", fontSize: 13, color: "var(--ok)" } satisfies CSSProperties,
} as const;
