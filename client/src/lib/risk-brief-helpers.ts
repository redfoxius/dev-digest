import type { Risk, ReviewFocusItem, RiskSeverity } from "@devdigest/shared";

/**
 * Derives the `flaggedRefs` map `BlastRadiusCard` (AC-24) and `page.tsx`
 * consume — a plain-object/pure transform, no React, no fetching, so it can
 * be unit-tested and memoized (`useMemo`) by the caller without re-deriving
 * on every render.
 *
 * Precedence rule (spec AC-24): every one of a risk's `file_refs` maps to
 * that risk's own `severity`; when the same ref is covered by more than one
 * risk, the HIGHER severity wins. Only once every risk-derived ref is
 * resolved do `reviewFocus[].file` entries get added — mapped to the neutral
 * `'flagged'` sentinel — but only for files not already keyed by a risk
 * (a risk's real severity always outranks the neutral sentinel).
 */
const SEVERITY_RANK: Record<RiskSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function buildFlaggedRefsMap(
  risks: Risk[],
  reviewFocus: ReviewFocusItem[],
): Map<string, RiskSeverity | "flagged"> {
  const map = new Map<string, RiskSeverity | "flagged">();

  for (const risk of risks) {
    for (const ref of risk.file_refs) {
      const existing = map.get(ref);
      if (
        existing === undefined ||
        existing === "flagged" ||
        SEVERITY_RANK[risk.severity] > SEVERITY_RANK[existing]
      ) {
        map.set(ref, risk.severity);
      }
    }
  }

  for (const item of reviewFocus) {
    if (!map.has(item.file)) {
      map.set(item.file, "flagged");
    }
  }

  return map;
}
