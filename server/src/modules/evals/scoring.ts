import type { EvalExpectation, Finding } from '@devdigest/shared';

/**
 * Pure eval scoring — recall/precision/citation-accuracy math over
 * already-produced findings, zero LLM calls (spec §6.4, AC-16–AC-21, AC-25).
 *
 * ZERO imports of Drizzle/Fastify/any LLM or HTTP client on purpose — mirrors
 * the "pure algorithm colocated in its owning module" pattern already
 * established by `repo-intel/pipeline/rank.ts`/`pipeline/sample.ts`
 * (`server/INSIGHTS.md` 2026-08-09 entries), so it stays hermetically
 * unit-testable without a DB or a real LLM adapter.
 */

// ===========================================================================
// Interval overlap
// ===========================================================================

/**
 * Closed-interval overlap check for `[aStart, aEnd]` vs `[bStart, bEnd]`,
 * order-agnostic on both ranges (a caller may pass `start > end`, matching
 * `groundFindings`'s own defensive `Math.min`/`Math.max` normalization).
 *
 * Deliberately a NEW, small reimplementation, not an import from
 * `reviewer-core/src/grounding.ts`: that module is explicitly listed
 * "unmodified" for this feature (spec §0/§5), and its own range-overlap
 * check (`rangeIntersects`) is private/unexported anyway. The semantics are
 * behaviorally equivalent — `rangeIntersects(lines, start, end)` asks "does
 * any integer in `[start,end]` appear in a pre-built line Set built from a
 * diff hunk's covered lines"; here both sides are ranges rather than one
 * range against a pre-expanded Set, so the equivalent check is the standard
 * closed-interval overlap test: the two ranges overlap iff the later of the
 * two starts is no later than the earlier of the two ends.
 */
export function linesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  return aLo <= bHi && bLo <= aHi;
}

// ===========================================================================
// Per-case scoring (AC-16–AC-20)
// ===========================================================================

/** One case's scoring result — the pure output of `scoreCase`. */
export interface CaseScore {
  recall: number;
  precision: number;
  citationAccuracy: number;
  pass: boolean;
  mustFindMatched: number;
  mustFindTotal: number;
  noiseCount: number;
  actualFindingsTotal: number;
}

/**
 * Score one case's execution. `findings` is the already-post-grounding,
 * already-post-scope-filter set `reviewPullRequest` returns
 * (`review.findings`, per the plan's Context section) — never re-grounded
 * here. `grounded`/`dropped` are that same call's own kept/dropped counts,
 * feeding `citationAccuracy` (AC-18) only — scoring never calls an LLM
 * (AC-20).
 */
export function scoreCase(
  expectations: EvalExpectation[],
  findings: Finding[],
  grounded: number,
  dropped: number,
): CaseScore {
  const mustFind = expectations.filter((e) => e.type === 'must_find');
  const mustNotFlag = expectations.filter((e) => e.type === 'must_not_flag');

  // AC-16: recall = matched must_find / total must_find, vacuous-true (1) at zero total.
  const mustFindMatched = mustFind.filter((exp) =>
    findings.some(
      (f) => f.file === exp.file && linesOverlap(exp.start_line, exp.end_line, f.start_line, f.end_line),
    ),
  ).length;
  const mustFindTotal = mustFind.length;
  const recall = mustFindTotal === 0 ? 1 : mustFindMatched / mustFindTotal;

  // AC-17: precision = (total findings - noise) / total findings, vacuous-true (1) at zero findings.
  // "Noise" = a finding whose file+lines overlap ANY must_not_flag expectation —
  // an unrelated finding elsewhere never counts as noise (AC-19).
  const noiseCount = findings.filter((f) =>
    mustNotFlag.some(
      (exp) => exp.file === f.file && linesOverlap(exp.start_line, exp.end_line, f.start_line, f.end_line),
    ),
  ).length;
  const actualFindingsTotal = findings.length;
  const precision = actualFindingsTotal === 0 ? 1 : (actualFindingsTotal - noiseCount) / actualFindingsTotal;

  // AC-18: citation_accuracy = grounded / (grounded + dropped), vacuous-true (1) when both are zero.
  const citationAccuracy = grounded + dropped === 0 ? 1 : grounded / (grounded + dropped);

  // AC-19: pass iff every must_find matched AND zero noise — an unrelated
  // finding elsewhere in the diff never fails the case.
  const pass = recall === 1 && noiseCount === 0;

  return {
    recall,
    precision,
    citationAccuracy,
    pass,
    mustFindMatched,
    mustFindTotal,
    noiseCount,
    actualFindingsTotal,
  };
}

// ===========================================================================
// Batch aggregation (AC-21)
// ===========================================================================

/**
 * One trace's contribution to a batch aggregate — a succeeded case's
 * `CaseScore` raw counts, its grounding counts, and its run metadata,
 * flattened into one simple shape a caller (e.g. WI-6's `runCases`) builds
 * per case. `failed: true` (AC-14) marks an isolated per-case failure: its
 * counts are excluded from the aggregate's ratio numerator/denominator, but
 * the trace itself still counts toward `tracesTotal`.
 */
export interface ScoreResult {
  failed: boolean;
  pass: boolean;
  mustFindMatched: number;
  mustFindTotal: number;
  noiseCount: number;
  actualFindingsTotal: number;
  grounded: number;
  dropped: number;
  durationMs: number;
  costUsd: number | null;
}

/** The micro-averaged aggregate `aggregateBatch` produces for one batch. */
export interface BatchAggregate {
  recall: number;
  precision: number;
  citationAccuracy: number;
  tracesPassed: number;
  tracesTotal: number;
  durationMs: number;
  costUsd: number | null;
}

/**
 * Aggregate a batch's traces via a MICRO-average — summed raw counts across
 * every succeeded trace, divided once — never a mean of each trace's own
 * ratio (AC-21). E.g. one case with 1/1 `must_find` matched and one with
 * 3/5 matched aggregates to `recall = 4/6` (≈0.667), not `(1 + 0.6)/2` (0.8).
 * Failed traces (AC-14) are excluded from every numerator/denominator here
 * but still counted in `tracesTotal` — the caller (dashboard/service layer)
 * is responsible for surfacing `traces_total` vs `traces_passed` separately.
 * A zero-trace (or all-failed) batch degrades to the same vacuous-true
 * defaults `scoreCase` uses per metric (AC-15's degenerate `EvalRun` shape).
 */
export function aggregateBatch(traces: ScoreResult[]): BatchAggregate {
  const tracesTotal = traces.length;
  const succeeded = traces.filter((t) => !t.failed);
  const tracesPassed = succeeded.filter((t) => t.pass).length;

  const mustFindMatchedSum = succeeded.reduce((sum, t) => sum + t.mustFindMatched, 0);
  const mustFindTotalSum = succeeded.reduce((sum, t) => sum + t.mustFindTotal, 0);
  const recall = mustFindTotalSum === 0 ? 1 : mustFindMatchedSum / mustFindTotalSum;

  const actualFindingsTotalSum = succeeded.reduce((sum, t) => sum + t.actualFindingsTotal, 0);
  const noiseCountSum = succeeded.reduce((sum, t) => sum + t.noiseCount, 0);
  const precision =
    actualFindingsTotalSum === 0 ? 1 : (actualFindingsTotalSum - noiseCountSum) / actualFindingsTotalSum;

  const groundedSum = succeeded.reduce((sum, t) => sum + t.grounded, 0);
  const droppedSum = succeeded.reduce((sum, t) => sum + t.dropped, 0);
  const citationAccuracy = groundedSum + droppedSum === 0 ? 1 : groundedSum / (groundedSum + droppedSum);

  // Duration reflects real wall-clock cost regardless of outcome, so it sums
  // over every trace, including failed ones — unlike the ratio metrics above.
  const durationMs = traces.reduce((sum, t) => sum + t.durationMs, 0);
  const costEntries = traces.filter((t) => t.costUsd !== null);
  const costUsd = costEntries.length === 0 ? null : costEntries.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);

  return { recall, precision, citationAccuracy, tracesPassed, tracesTotal, durationMs, costUsd };
}

// ===========================================================================
// Alert template (AC-25)
// ===========================================================================

/** The three dashboard metrics an alert compares batch-over-batch. */
export interface MetricSnapshot {
  recall: number;
  precision: number;
  citation_accuracy: number;
}

/** 2 percentage points — AC-25's own bound for "differs by at least...". */
const ALERT_THRESHOLD = 0.02;

type MetricKey = keyof MetricSnapshot;

const METRIC_LABEL: Record<MetricKey, string> = {
  recall: 'Recall',
  precision: 'Precision',
  citation_accuracy: 'Citation accuracy',
};

function toPoints(delta: number): number {
  return Math.round(Math.abs(delta) * 100);
}

function directionWord(delta: number): 'up' | 'down' | 'flat' {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

/**
 * Build a deterministic, template-generated alert sentence when at least
 * one metric swings by >= 2pts between two consecutive batches (AC-25).
 * `previous === null` (no prior batch to compare against) always yields
 * `null`. Otherwise the headline prefers a REGRESSING metric (one that
 * dropped by >= 2pts) over a raw-magnitude comparison — e.g. AC-25's own
 * worked example (precision -0.02, recall +0.04, citation +0.01) headlines
 * precision's drop, not recall's larger rise, since a regression is the
 * more actionable signal even when a same-direction improvement moved
 * further. Only when NO metric regressed by >= 2pts (all deltas are flat
 * or improving) does the headline fall back to whichever metric has the
 * largest absolute delta. Either way the sentence pairs the headline
 * (direction + magnitude in points) with a brief note on the other two
 * metrics' directions — e.g.
 * `"Precision dipped 2pts — recall and citation accuracy both up."`.
 * Pure string interpolation, no randomness — same inputs always produce the
 * same sentence (or the same `null`).
 */
export function buildAlert(current: MetricSnapshot, previous: MetricSnapshot | null): string | null {
  if (previous === null) return null;

  const deltas: Record<MetricKey, number> = {
    recall: current.recall - previous.recall,
    precision: current.precision - previous.precision,
    citation_accuracy: current.citation_accuracy - previous.citation_accuracy,
  };

  const keys = Object.keys(deltas) as MetricKey[];

  // Prefer the largest REGRESSION (most negative delta) among metrics that
  // dropped by at least the threshold — a drop is always worth headlining
  // over a same-or-larger-magnitude improvement elsewhere.
  const regressing = keys.filter((k) => deltas[k] <= -ALERT_THRESHOLD);
  const maxKey =
    regressing.length > 0
      ? regressing.reduce((a, b) => (deltas[b] < deltas[a] ? b : a))
      : keys.reduce((a, b) => (Math.abs(deltas[b]) > Math.abs(deltas[a]) ? b : a));
  const maxDelta = deltas[maxKey];

  if (Math.abs(maxDelta) < ALERT_THRESHOLD) return null;

  const direction = maxDelta >= 0 ? 'rose' : 'dipped';
  const headline = `${METRIC_LABEL[maxKey]} ${direction} ${toPoints(maxDelta)}pts`;

  const [k1, k2] = keys.filter((k) => k !== maxKey) as [MetricKey, MetricKey];
  const d1 = directionWord(deltas[k1]);
  const d2 = directionWord(deltas[k2]);
  const label1 = METRIC_LABEL[k1].toLowerCase();
  const label2 = METRIC_LABEL[k2].toLowerCase();

  const note = d1 === d2 ? `${label1} and ${label2} both ${d1}` : `${label1} ${d1}, ${label2} ${d2}`;

  return `${headline} — ${note}.`;
}
