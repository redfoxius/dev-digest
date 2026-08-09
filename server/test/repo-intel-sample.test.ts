/**
 * Phase 7.3 — pure-logic unit tests for `stratifyByLanguage`
 * (docs/go-language-support-plan.md). No DB, no clock: pins the reservation
 * math against a synthetic ranked-path list, independent of real PageRank
 * tie-breaking (which `conventions-go.it.test.ts`'s real-DB coverage would
 * be too fragile to assert exact slot counts against).
 */
import { describe, it, expect } from 'vitest';
import { stratifyByLanguage } from '../src/modules/repo-intel/pipeline/sample.js';
import { languageIdForFile } from '../src/modules/repo-intel/languages/index.js';

describe('stratifyByLanguage', () => {
  it('reserves an even split across languages, even when one language would otherwise be crowded out', () => {
    // 15 TS files rank above 1 Go file — a plain top-12 unstratified slice
    // would exclude the Go file entirely.
    const tsFiles = Array.from({ length: 15 }, (_, i) => `src/mod${i}.ts`);
    const ranked = [...tsFiles, 'main.go'];

    const plainTop12 = ranked.slice(0, 12);
    expect(plainTop12).not.toContain('main.go'); // confirms the crowd-out this fixes

    const stratified = stratifyByLanguage(ranked, ['typescript', 'go'], 12, languageIdForFile);
    expect(stratified).toContain('main.go');
    expect(stratified.length).toBe(12);
  });

  it('fills leftover slots with global top-rank once every language quota is exhausted', () => {
    // Only 2 Go files exist — the 6-slot Go reservation can't be filled, so
    // the leftover slots go to TS top-rank fill instead of staying empty.
    const ranked = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'x.go', 'y.go'];
    const out = stratifyByLanguage(ranked, ['typescript', 'go'], 6, languageIdForFile);
    expect(out.length).toBe(6);
    expect(out).toContain('x.go');
    expect(out).toContain('y.go');
    // Fill picks top-rank TS files (a-d), not e.ts, to reach 6 total.
    expect(out).toEqual(expect.arrayContaining(['a.ts', 'b.ts', 'c.ts', 'd.ts']));
  });

  it('degrades to a plain top-N slice for zero languages', () => {
    const ranked = ['a.ts', 'b.ts', 'c.ts'];
    expect(stratifyByLanguage(ranked, [], 2, languageIdForFile)).toEqual(['a.ts', 'b.ts']);
  });

  it('returns [] for n <= 0', () => {
    expect(stratifyByLanguage(['a.ts'], ['typescript'], 0, languageIdForFile)).toEqual([]);
  });

  it('never returns more than n paths, and never duplicates a path', () => {
    const ranked = ['a.go', 'b.go', 'a.ts', 'b.ts', 'c.ts'];
    const out = stratifyByLanguage(ranked, ['typescript', 'go'], 3, languageIdForFile);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(new Set(out).size).toBe(out.length);
  });
});
