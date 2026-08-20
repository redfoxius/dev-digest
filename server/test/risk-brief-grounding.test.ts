/**
 * Grounding + output bounding unit tests
 * (`specs/cross-cutting/pr-why-risk-brief/plan.md` Work Item 6, spec §6.2
 * AC-10/AC-11/AC-12) — plain unit tests, no DB, no Container.
 */
import { describe, it, expect } from 'vitest';
import type { DiffHunk, Risk, ReviewFocusItem } from '@devdigest/shared';
import { filterRiskRefs, filterReviewFocus, boundRiskBriefOutput } from '../src/modules/risk-brief/grounding.js';

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    kind: 'security',
    title: 'Auth surface touched',
    explanation: 'This PR touches session handling.',
    severity: 'high',
    file_refs: [],
    ...overrides,
  };
}

function focusItem(overrides: Partial<ReviewFocusItem> = {}): ReviewFocusItem {
  return {
    file: 'src/config.ts',
    line: 12,
    reason: 'New env var read here.',
    ...overrides,
  };
}

function hunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    file: 'src/config.ts',
    oldStart: 1,
    oldLines: 5,
    newStart: 1,
    newLines: 5,
    newLineNumbers: [1, 2, 3, 4, 5],
    ...overrides,
  };
}

describe('filterRiskRefs', () => {
  // AC-10 widening: the caller unions diff files + blast changed_symbols +
  // endpoints/crons + caller files into validPaths — this fixture models a
  // caller-only file (not in the diff) surviving because it IS in validPaths.
  const diffFile = 'src/config.ts';
  const callerOnlyFile = 'src/legacy/reader.ts'; // only reachable via downstream[].callers[].file
  const validPaths = new Set([diffFile, callerOnlyFile]);

  it('drops a fabricated file path not present in validPaths', () => {
    const risks = [risk({ file_refs: ['src/does-not-exist.ts'] })];
    expect(filterRiskRefs(risks, validPaths)).toEqual([]);
  });

  it('keeps a risk citing a real caller-only file (not a diff file, only in downstream callers)', () => {
    const risks = [risk({ file_refs: [callerOnlyFile] })];
    const result = filterRiskRefs(risks, validPaths);
    expect(result).toHaveLength(1);
    expect(result[0]!.file_refs).toEqual([callerOnlyFile]);
  });

  it('keeps only the matching subset when a risk cites a mix of valid and fabricated paths', () => {
    const risks = [risk({ file_refs: [diffFile, 'src/fabricated.ts'] })];
    const result = filterRiskRefs(risks, validPaths);
    expect(result).toHaveLength(1);
    expect(result[0]!.file_refs).toEqual([diffFile]);
  });

  it('a risk with file_refs: [] to begin with is never dropped for that reason', () => {
    const risks = [risk({ title: 'No tests added', file_refs: [] })];
    const result = filterRiskRefs(risks, validPaths);
    expect(result).toHaveLength(1);
    expect(result[0]!.file_refs).toEqual([]);
  });

  it('accepts a plain array as well as a Set for validPaths', () => {
    const risks = [risk({ file_refs: [diffFile] })];
    expect(filterRiskRefs(risks, [diffFile])).toHaveLength(1);
  });

  it('null/undefined input returns []', () => {
    expect(filterRiskRefs(null, validPaths)).toEqual([]);
    expect(filterRiskRefs(undefined, validPaths)).toEqual([]);
  });
});

describe('filterReviewFocus', () => {
  const diffFilesToHunks = new Map<string, DiffHunk[]>([['src/config.ts', [hunk()]]]);
  // Same caller-only file as above — valid for filterRiskRefs's set, but NOT
  // a diff file, so filterReviewFocus (diff-files-only, by design) must still
  // drop it — proving the two functions use genuinely different valid-sets.
  const callerOnlyFile = 'src/legacy/reader.ts';

  it('drops an entry whose file is not a diff file (a real caller-only file, valid for risks but not review_focus)', () => {
    const items = [focusItem({ file: callerOnlyFile, line: 3 })];
    expect(filterReviewFocus(items, diffFilesToHunks)).toEqual([]);
  });

  it('keeps an entry whose file and line are within a real diff hunk range', () => {
    const items = [focusItem({ file: 'src/config.ts', line: 3 })];
    expect(filterReviewFocus(items, diffFilesToHunks)).toEqual(items);
  });

  it('drops an entry whose line falls outside every hunk new-line range for its file', () => {
    const items = [focusItem({ file: 'src/config.ts', line: 999 })];
    expect(filterReviewFocus(items, diffFilesToHunks)).toEqual([]);
  });

  it('keeps entries within range while dropping out-of-range ones from a mixed list', () => {
    const inRange = focusItem({ file: 'src/config.ts', line: 2 });
    const outOfRange = focusItem({ file: 'src/config.ts', line: 42 });
    const result = filterReviewFocus([inRange, outOfRange], diffFilesToHunks);
    expect(result).toEqual([inRange]);
  });

  it('null/undefined input returns []', () => {
    expect(filterReviewFocus(null, diffFilesToHunks)).toEqual([]);
    expect(filterReviewFocus(undefined, diffFilesToHunks)).toEqual([]);
  });
});

describe('boundRiskBriefOutput', () => {
  it('truncates an oversized mocked LLM response to the documented caps', () => {
    const oversizedRisks = Array.from({ length: 12 }, (_, i) => risk({ title: `Risk ${i}` }));
    const oversizedFocus = Array.from({ length: 12 }, (_, i) => focusItem({ line: i + 1 }));
    const longWhat = 'w'.repeat(700);
    const longWhy = 'y'.repeat(700);

    const result = boundRiskBriefOutput(oversizedRisks, oversizedFocus, longWhat, longWhy);

    expect(result.risks).toHaveLength(8);
    expect(result.risks).toEqual(oversizedRisks.slice(0, 8));
    expect(result.review_focus).toHaveLength(8);
    expect(result.review_focus).toEqual(oversizedFocus.slice(0, 8));
    expect(result.what).toHaveLength(600);
    expect(result.what).toBe('w'.repeat(600));
    expect(result.why).toHaveLength(600);
    expect(result.why).toBe('y'.repeat(600));
  });

  it('leaves an already-within-bounds input unchanged', () => {
    const risks = [risk()];
    const focus = [focusItem()];
    const result = boundRiskBriefOutput(risks, focus, 'short what', 'short why');
    expect(result).toEqual({ risks, review_focus: focus, what: 'short what', why: 'short why' });
  });
});
