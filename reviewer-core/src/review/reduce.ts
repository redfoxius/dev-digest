import type { Finding, Review, UnifiedDiff } from '@devdigest/shared';

/**
 * Reduce + slice helpers for map-reduce reviews. Pure (no DB / `this`), so they
 * live in the engine and are shared by the server and the CI runner.
 */

/**
 * Per-severity penalty subtracted from a perfect 100. Chosen so the score
 * tracks the findings the UI actually shows: 0 findings ⇒ 100, one suggestion
 * ⇒ 97, one warning ⇒ 88, one critical ⇒ 65.
 */
const SEVERITY_PENALTY: Record<Finding['severity'], number> = {
  CRITICAL: 35,
  WARNING: 12,
  SUGGESTION: 3,
};

/**
 * Deterministic 0–100 quality score derived from the (grounded) findings —
 * NOT the model's self-reported `score`, which has no anchor and drifts wildly
 * between models (a cheap model can "approve" with zero findings yet emit 10).
 * This mirrors how the review *event* is already computed from severities in
 * `to-review.ts`, so the number on screen can never contradict the findings
 * beneath it.
 */
export function scoreFromFindings(findings: Finding[]): number {
  const penalty = findings.reduce((sum, f) => sum + (SEVERITY_PENALTY[f.severity] ?? 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

/** One severity step down (floors at SUGGESTION) — used to soften, never to
 *  silently remove, an out-of-scope finding (see `filterByScope`). */
const DOWNGRADE: Record<Finding['severity'], Finding['severity']> = {
  CRITICAL: 'WARNING',
  WARNING: 'SUGGESTION',
  SUGGESTION: 'SUGGESTION',
};

/**
 * Intent Layer — deterministic scope filtering, pure (findings in, findings
 * out), same "determinism-over-model-self-report" philosophy as
 * `scoreFromFindings` above. Called from `reviewPullRequest()` after the
 * citation-grounding gate, and only when intent was actually provided.
 *
 * Safety-critical kinds (secret_leak, lethal_trifecta, phantom, hook) always
 * pass through regardless of declared scope — only ordinary 'finding'-kind
 * findings are scope-filtered. Every in-scope finding is kept as-is.
 * Out-of-scope findings are advisory, NOT unconditionally dropped: every one
 * is kept, one severity rank softer (CRITICAL→WARNING→SUGGESTION, floored at
 * SUGGESTION). `intent`/`in_scope` are derived from attacker-controlled PR
 * content (title/body/linked issue/spec) by a cheap LLM classifier — an
 * unconditional drop would let a crafted PR description make a genuine
 * CRITICAL vulnerability finding vanish outright (never persisted, only a
 * trace log line survives). Softening instead of dropping means the worst a
 * scope misclassification can do is understate severity, never erase the
 * finding — pr-self-review security-skill finding on PR #15.
 */
export function filterByScope(findings: Finding[]): { kept: Finding[]; downgraded: Finding[] } {
  const scoreable = findings.filter((f) => (f.kind ?? 'finding') === 'finding');
  const exempt = findings.filter((f) => (f.kind ?? 'finding') !== 'finding');
  const inScope = scoreable.filter((f) => f.in_scope !== false);
  const outOfScope = scoreable.filter((f) => f.in_scope === false);

  const downgraded = outOfScope.map((f) => ({ ...f, severity: DOWNGRADE[f.severity] }));

  const kept = [...exempt, ...inScope, ...downgraded];
  return { kept, downgraded };
}

/** Verdict severity order for the reduce step (worst verdict wins). */
const VERDICT_RANK: Record<string, number> = {
  request_changes: 2,
  comment: 1,
  approve: 0,
};

/**
 * Merge N partial Reviews (one per mapped file/chunk) into a single Review:
 * concat findings, take the worst verdict, mean score, joined summaries.
 */
export function reduceReviews(partials: Review[]): Review {
  if (partials.length === 1) return partials[0]!;
  const findings = partials.flatMap((p) => p.findings);
  let verdict: Review['verdict'] = 'approve';
  for (const p of partials) {
    if ((VERDICT_RANK[p.verdict] ?? 0) > (VERDICT_RANK[verdict] ?? 0)) verdict = p.verdict;
  }
  const score = partials.length
    ? Math.round(partials.reduce((s, p) => s + p.score, 0) / partials.length)
    : 0;
  const summary = partials.map((p) => p.summary).filter(Boolean).join(' ');
  return { verdict, score, summary, findings };
}

/** Extract the slice of the unified diff for a single file (for map chunks). */
export function sliceDiff(diff: UnifiedDiff, path: string): string {
  const lines = diff.raw.split('\n');
  const out: string[] = [];
  let capture = false;
  for (const line of lines) {
    if (line.startsWith('diff --git'))
      capture = line.includes(`b/${path}`) || line.includes(` ${path}`);
    if (capture) out.push(line);
  }
  if (out.length > 0) return out.join('\n');
  // fallback: synthesize from the file's hunks
  const f = diff.files.find((x) => x.path === path);
  if (!f) return diff.raw;
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}`;
}
