import type { RiskSeverity } from "@devdigest/shared";

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
