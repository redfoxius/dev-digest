import type { ConciseFinding, ConciseReviewResult, FindingsReviewItem, ReviewRecord } from './types.js';

/** Shared by both mappers below so the finding-trimming rule lives in one
 *  place (mirrors `server/src/modules/reviews/helpers.ts`'s `reviewToDto`). */
function mapFindings(findings: ReviewRecord['findings']): ConciseFinding[] {
  return findings.map((f) => ({
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    severity: f.severity,
    category: f.category,
    title: f.title,
    rationale: f.rationale,
    suggestion: f.suggestion ?? null,
  }));
}

/**
 * `run_agent_on_pr`'s success-case output shape — one already-known run,
 * so `run_id` is the caller-supplied id rather than read off `review`.
 */
export function mapReviewToConciseResult(review: ReviewRecord, runId: string): ConciseReviewResult {
  return {
    status: 'done',
    run_id: runId,
    verdict: review.verdict ?? null,
    summary: review.summary ?? null,
    score: review.score ?? null,
    findings: mapFindings(review.findings),
  };
}

/**
 * `get_findings`' per-review shape — carries agent identity since that
 * tool returns every agent's review for a PR in one call, not a single
 * caller-known run (`tools/get-findings.ts`).
 */
export function mapReviewToFindingsItem(review: ReviewRecord): FindingsReviewItem {
  return {
    run_id: review.run_id ?? null,
    agent_id: review.agent_id ?? null,
    agent_name: review.agent_name ?? null,
    verdict: review.verdict ?? null,
    summary: review.summary ?? null,
    score: review.score ?? null,
    findings: mapFindings(review.findings),
  };
}
