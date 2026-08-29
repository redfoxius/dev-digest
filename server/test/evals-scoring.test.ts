import { describe, it, expect } from 'vitest';
import type { EvalExpectation, Finding } from '@devdigest/shared';
import {
  linesOverlap,
  scoreCase,
  aggregateBatch,
  buildAlert,
  type ScoreResult,
} from '../src/modules/evals/scoring.js';

/**
 * Unit coverage for the pure eval-scoring module (spec §6.4, AC-16–AC-21,
 * AC-25) — no DB, no LLM, no Fastify. Per the plan's own note, the `4/6` vs
 * `0.8` micro-average distinction (AC-21) is the single highest-value
 * regression test here, written first.
 */

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    severity: 'warning',
    category: 'bug',
    title: 'Something',
    file: 'src/config.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'because',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifecta_components: null,
    evidence: null,
    ...overrides,
  } as Finding;
}

function expectation(overrides: Partial<EvalExpectation> = {}): EvalExpectation {
  return {
    type: 'must_find',
    file: 'src/config.ts',
    start_line: 10,
    end_line: 12,
    description: null,
    ...overrides,
  };
}

describe('linesOverlap', () => {
  it('is true when two closed ranges share at least one line', () => {
    expect(linesOverlap(10, 12, 12, 20)).toBe(true);
    expect(linesOverlap(10, 12, 5, 10)).toBe(true);
    expect(linesOverlap(10, 20, 12, 15)).toBe(true); // fully contained
  });

  it('is false when two closed ranges never touch', () => {
    expect(linesOverlap(10, 12, 13, 20)).toBe(false);
    expect(linesOverlap(10, 12, 1, 9)).toBe(false);
  });

  it('normalizes an out-of-order range (start > end) the same as groundFindings does', () => {
    expect(linesOverlap(12, 10, 11, 11)).toBe(true);
    expect(linesOverlap(10, 12, 20, 13)).toBe(false);
  });
});

describe('scoreCase — AC-16 recall', () => {
  it('matches only some must_find expectations → recall = matched/total', () => {
    const expectations = [
      expectation({ start_line: 10, end_line: 12 }),
      expectation({ start_line: 50, end_line: 52 }),
    ];
    const findings = [finding({ start_line: 10, end_line: 12 })]; // only the first is matched
    const result = scoreCase(expectations, findings, 1, 0);
    expect(result.recall).toBe(0.5);
    expect(result.mustFindMatched).toBe(1);
    expect(result.mustFindTotal).toBe(2);
  });

  it('is vacuously 1 for a case with zero must_find expectations, regardless of actual findings', () => {
    const expectations = [expectation({ type: 'must_not_flag' })];
    const findings = [finding(), finding({ id: 'f-2', file: 'other.ts' })];
    const result = scoreCase(expectations, findings, 2, 0);
    expect(result.recall).toBe(1);
    expect(result.mustFindTotal).toBe(0);
  });
});

describe('scoreCase — AC-17 precision', () => {
  it('counts a finding overlapping a must_not_flag location as noise', () => {
    const expectations = [expectation({ type: 'must_not_flag', start_line: 10, end_line: 12 })];
    const findings = [
      finding({ id: 'f-1', start_line: 10, end_line: 12 }), // noise
      finding({ id: 'f-2', start_line: 40, end_line: 42 }), // not noise
    ];
    const result = scoreCase(expectations, findings, 2, 0);
    expect(result.precision).toBe(0.5);
    expect(result.noiseCount).toBe(1);
    expect(result.actualFindingsTotal).toBe(2);
  });

  it('is vacuously 1 when the case produces zero actual findings', () => {
    const expectations = [expectation({ type: 'must_not_flag' })];
    const result = scoreCase(expectations, [], 0, 0);
    expect(result.precision).toBe(1);
  });
});

describe('scoreCase — AC-18 citation accuracy', () => {
  it('is grounded / (grounded + dropped)', () => {
    const result = scoreCase([], [], 3, 1);
    expect(result.citationAccuracy).toBe(0.75);
  });

  it('is vacuously 1 when both grounded and dropped are zero', () => {
    const result = scoreCase([], [], 0, 0);
    expect(result.citationAccuracy).toBe(1);
  });
});

describe('scoreCase — AC-19 pass rule (unrelated finding is never penalized)', () => {
  it('passes when zero must_find expectations, one must_not_flag, and an unrelated finding elsewhere', () => {
    const expectations = [
      expectation({ type: 'must_not_flag', file: 'src/config.ts', start_line: 10, end_line: 12 }),
    ];
    const findings = [
      finding({ id: 'f-1', file: 'src/other.ts', start_line: 1, end_line: 2 }), // unrelated file
      finding({ id: 'f-2', file: 'src/config.ts', start_line: 100, end_line: 101 }), // unrelated location, same file
    ];
    const result = scoreCase(expectations, findings, 2, 0);
    expect(result.noiseCount).toBe(0);
    expect(result.recall).toBe(1); // vacuous — zero must_find expectations
    expect(result.pass).toBe(true);
  });

  it('fails when a finding overlaps the must_not_flag location', () => {
    const expectations = [expectation({ type: 'must_not_flag', start_line: 10, end_line: 12 })];
    const findings = [finding({ start_line: 10, end_line: 12 })];
    const result = scoreCase(expectations, findings, 1, 0);
    expect(result.pass).toBe(false);
  });

  it('fails when a must_find expectation is unmatched, even with zero noise', () => {
    const expectations = [expectation({ type: 'must_find' })];
    const result = scoreCase(expectations, [], 0, 0);
    expect(result.recall).toBe(0);
    expect(result.pass).toBe(false);
  });
});

describe('scoreCase — AC-20 zero LLM calls', () => {
  it('never touches any LLM-shaped object — scoring is pure arithmetic over Finding[]/EvalExpectation[]', () => {
    const llm = {
      completeStructured: () => {
        throw new Error('scoring must never call an LLM');
      },
    };
    // scoreCase's signature has no LLM parameter at all — this test documents
    // that fact by simply never passing `llm` anywhere near it.
    const result = scoreCase([expectation()], [finding()], 1, 0);
    expect(result.pass).toBe(true);
    expect(llm.completeStructured).toBeInstanceOf(Function); // never invoked
  });
});

describe('aggregateBatch — AC-21 micro-average (the 4/6 vs 0.8 regression test)', () => {
  function succeededTrace(overrides: Partial<ScoreResult> = {}): ScoreResult {
    return {
      failed: false,
      pass: true,
      mustFindMatched: 0,
      mustFindTotal: 0,
      noiseCount: 0,
      actualFindingsTotal: 0,
      grounded: 0,
      dropped: 0,
      durationMs: 100,
      costUsd: 0.01,
      ...overrides,
    };
  }

  it('aggregates recall as summed-matched/summed-total (4/6), NOT the mean of per-case ratios (0.8)', () => {
    const traces: ScoreResult[] = [
      succeededTrace({ mustFindMatched: 1, mustFindTotal: 1 }), // 1/1 = 1.0
      succeededTrace({ mustFindMatched: 3, mustFindTotal: 5 }), // 3/5 = 0.6
    ];
    const agg = aggregateBatch(traces);
    expect(agg.recall).toBeCloseTo(4 / 6, 9);
    expect(agg.recall).not.toBeCloseTo(0.8, 2); // the wrong, mean-of-ratios answer
  });

  it('excludes a failed trace from every ratio numerator/denominator but still counts it in tracesTotal', () => {
    const traces: ScoreResult[] = [
      succeededTrace({ mustFindMatched: 1, mustFindTotal: 1, pass: true }),
      { ...succeededTrace(), failed: true, pass: false, mustFindMatched: 999, mustFindTotal: 999 },
    ];
    const agg = aggregateBatch(traces);
    expect(agg.tracesTotal).toBe(2);
    expect(agg.tracesPassed).toBe(1);
    expect(agg.recall).toBe(1); // only the succeeded trace's 1/1 contributes
  });

  it('degrades to the AC-15 vacuous-true defaults for a zero-trace batch', () => {
    const agg = aggregateBatch([]);
    expect(agg.tracesTotal).toBe(0);
    expect(agg.tracesPassed).toBe(0);
    expect(agg.recall).toBe(1);
    expect(agg.precision).toBe(1);
    expect(agg.citationAccuracy).toBe(1);
    expect(agg.costUsd).toBeNull();
  });

  it('micro-averages precision and citation_accuracy the same way (summed counts, not mean of ratios)', () => {
    const traces: ScoreResult[] = [
      succeededTrace({ actualFindingsTotal: 2, noiseCount: 1 }), // precision 0.5
      succeededTrace({ actualFindingsTotal: 8, noiseCount: 0 }), // precision 1.0
      // mean would be 0.75; micro-average is (2+8-1-0)/(2+8) = 9/10 = 0.9
    ];
    const agg = aggregateBatch(traces);
    expect(agg.precision).toBeCloseTo(0.9, 9);
  });
});

describe('buildAlert — AC-25', () => {
  it('returns null when there is no previous batch to compare against', () => {
    expect(buildAlert({ recall: 0.8, precision: 0.9, citation_accuracy: 0.95 }, null)).toBeNull();
  });

  it('returns null when every metric moves by less than 2 percentage points', () => {
    const current = { recall: 0.8, precision: 0.9, citation_accuracy: 0.95 };
    const previous = { recall: 0.79, precision: 0.905, citation_accuracy: 0.94 };
    expect(buildAlert(current, previous)).toBeNull();
  });

  it('headlines precision dipping 2pts when it is the largest-magnitude swing', () => {
    // recall/citation both move +0.01 (below threshold, same direction) —
    // precision's -0.02 is the largest absolute delta.
    const previous = { recall: 0.79, precision: 0.93, citation_accuracy: 0.94 };
    const current = { recall: 0.8, precision: 0.91, citation_accuracy: 0.95 };
    const alert = buildAlert(current, previous);
    expect(alert).toBe('Precision dipped 2pts — recall and citation accuracy both up.');
  });

  it('mentions a metric that individually crosses the threshold even when it is not the headline', () => {
    // AC-25's own worked example: precision -0.02, recall +0.04, citation +0.01.
    // Recall has the largest absolute delta (4pts) so it headlines; the
    // sentence still names precision's drop in the trailing note.
    const previous = { recall: 0.76, precision: 0.93, citation_accuracy: 0.94 };
    const current = { recall: 0.8, precision: 0.91, citation_accuracy: 0.95 };
    const alert = buildAlert(current, previous);
    expect(alert).toContain('Recall rose 4pts');
    expect(alert).toContain('precision down');
    expect(alert).toContain('citation accuracy up');
  });

  it('is deterministic — identical inputs always produce the identical sentence', () => {
    const previous = { recall: 0.79, precision: 0.93, citation_accuracy: 0.94 };
    const current = { recall: 0.8, precision: 0.91, citation_accuracy: 0.95 };
    expect(buildAlert(current, previous)).toBe(buildAlert(current, previous));
  });
});
