import type { RiskSeverity } from "@devdigest/shared";
import { RISK_SEVERITY_COLOR } from "@/lib/risk-severity";

/** Dot fill color for a flagged ref — the real severity color for a real
 *  `RiskSeverity`, or the neutral muted token for the `'flagged'`
 *  sentinel (a ref cited only via `review_focus[]`, not any `risks[]`
 *  entry). */
export function flaggedDotColor(value: RiskSeverity | "flagged"): string {
  return value === "flagged" ? "var(--text-muted)" : RISK_SEVERITY_COLOR[value].color;
}

/** Appends the "flagged by Risk Brief" suffix (plus the severity word,
 *  when it's a real severity and not the neutral sentinel) to a row's
 *  existing title/accessible-name text (AC-24). */
export function withFlaggedSuffix(title: string, value: RiskSeverity | "flagged"): string {
  return value === "flagged"
    ? `${title} — flagged by Risk Brief`
    : `${title} — flagged by Risk Brief (${value})`;
}
