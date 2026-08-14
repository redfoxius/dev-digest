import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffViewer (mirrors the flat DiffViewer's own
 *  `../styles.ts` convention). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 2px",
    cursor: "pointer",
    background: "none",
    border: "none",
    width: "100%",
    textAlign: "left",
  } satisfies CSSProperties,
  roleDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    flexShrink: 0,
  } satisfies CSSProperties,
  roleTitle: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  roleDescription: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  roleFileCount: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  sectionBody: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  /** Phase 6's `split_suggestion` banner — rendered only when `too_big`,
   *  above the group list. */
  splitBanner: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--accent-bg)",
  } satisfies CSSProperties,
  splitBannerTitle: { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  splitBannerBody: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  splitChips: { display: "flex", flexWrap: "wrap", gap: 8 } satisfies CSSProperties,
} as const;
