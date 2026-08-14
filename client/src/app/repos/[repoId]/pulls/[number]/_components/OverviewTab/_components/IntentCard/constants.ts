import type { EvidenceTier, RiskSeverity } from "@devdigest/shared";

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

/**
 * Risk-severity chip coloring/icon (Phase 1 — Risk Areas,
 * docs/intent-smartdiff-improvements.md). `RiskSeverity` ('high'/'medium'/
 * 'low') is a DISTINCT enum from `Severity` ('CRITICAL'/'WARNING'/
 * 'SUGGESTION') — never conflate them or reuse `SeverityBadge`/`SEV_COLOR`
 * for a risk's severity.
 */
export const RISK_SEVERITY_COLOR: Record<
  RiskSeverity,
  { color: string; bg: string; icon: "AlertOctagon" | "AlertTriangle" | "Info" }
> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  low: { color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "Info" },
};
