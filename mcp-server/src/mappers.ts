import type { ConciseFinding, ConciseReviewResult, ReviewRecord } from './types.js';

/**
 * The ONE shared response-shaping helper for the output shape
 * `run_agent_on_pr` and `get_findings` both return (Phase B/C tools),
 * so neither tool duplicates or independently drifts on this mapping
 * (onion-architecture skill review, docs/mcp-server-plan.md's "Port &
 * Composition Root" section, MEDIUM finding — mirrors
 * `server/src/modules/reviews/helpers.ts`'s `reviewToDto`).
 */
export function mapReviewToConciseResult(review: ReviewRecord, runId: string): ConciseReviewResult {
  const findings: ConciseFinding[] = review.findings.map((f) => ({
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    severity: f.severity,
    category: f.category,
    title: f.title,
    rationale: f.rationale,
    suggestion: f.suggestion ?? null,
  }));

  return {
    status: 'done',
    run_id: runId,
    verdict: review.verdict ?? null,
    summary: review.summary ?? null,
    score: review.score ?? null,
    findings,
  };
}
