import type { Finding } from '@devdigest/shared';
import { gateTriggered } from '@devdigest/reviewer-core';

/** Exit code contract — documented in `--help` and README.md. */
export const EXIT_OK = 0;
export const EXIT_BLOCKING_FINDINGS = 1;
export const EXIT_REVIEW_FAILED = 2;

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

function sortedFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
  );
}

/** Prints findings to stdout: severity, file:line, title, rationale. */
export function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log('No findings.');
    return;
  }
  for (const f of sortedFindings(findings)) {
    const loc = `${f.file}:${f.start_line}${f.end_line !== f.start_line ? `-${f.end_line}` : ''}`;
    console.log(`[${f.severity}] ${loc} — ${f.title}`);
    console.log(`  ${f.rationale}`);
    if (f.suggestion) console.log(`  Suggestion: ${f.suggestion}`);
  }
}

/**
 * Deterministic exit code from the SAME gate function `toReviewPayload` uses
 * to decide REQUEST_CHANGES — never a second, hand-rolled severity check.
 */
export function exitCodeForFindings(findings: Finding[]): typeof EXIT_OK | typeof EXIT_BLOCKING_FINDINGS {
  return gateTriggered(findings, 'critical') ? EXIT_BLOCKING_FINDINGS : EXIT_OK;
}
