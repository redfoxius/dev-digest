import type { EvidenceTier } from "@devdigest/shared";

/**
 * Qualitative (never numeric) evidence-tier badge coloring. The label text
 * itself lives in `messages/en/brief.json`'s `intentCard.evidence.*` keys
 * (next-intl) — not here, so it stays translatable. No confidence
 * percentage is ever rendered here — only this badge.
 */
export const EVIDENCE_TIER_COLOR: Record<EvidenceTier, { color: string; bg: string }> = {
  direct: { color: "var(--info)", bg: "var(--info-bg)" },
  ticket_only: { color: "var(--warn)", bg: "var(--warn-bg)" },
  indirect_only: { color: "var(--text-muted)", bg: "var(--bg-hover)" },
};
