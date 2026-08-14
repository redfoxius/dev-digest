import { describe, it, expect } from 'vitest';
import { filterRiskFileRefs, type RiskDerivation } from '../src/modules/intent/service.js';

/**
 * Plain unit test (no DB) — Phase 1 of `docs/intent-smartdiff-improvements.md`.
 * Covers `filterRiskFileRefs`'s five documented cases: never trust a raw
 * model-cited file path against the diff's actual file list.
 */
describe('filterRiskFileRefs', () => {
  const filePaths = ['src/auth/session.ts', 'src/config.ts'];

  function risk(overrides: Partial<RiskDerivation> = {}): RiskDerivation {
    return {
      kind: 'security',
      title: 'Auth surface touched',
      explanation: 'This PR touches session handling.',
      severity: 'high',
      file_refs: [],
      ...overrides,
    };
  }

  it('full-match file_refs are kept unchanged', () => {
    const risks = [risk({ file_refs: ['src/auth/session.ts', 'src/config.ts'] })];
    const result = filterRiskFileRefs(risks, filePaths);
    expect(result).toHaveLength(1);
    expect(result[0]!.file_refs).toEqual(['src/auth/session.ts', 'src/config.ts']);
  });

  it('no-match file_refs cause the risk to be dropped entirely', () => {
    const risks = [risk({ file_refs: ['src/not-in-diff.ts'] })];
    const result = filterRiskFileRefs(risks, filePaths);
    expect(result).toEqual([]);
  });

  it('partial-match file_refs are kept with only the matching paths', () => {
    const risks = [risk({ file_refs: ['src/auth/session.ts', 'src/not-in-diff.ts'] })];
    const result = filterRiskFileRefs(risks, filePaths);
    expect(result).toHaveLength(1);
    expect(result[0]!.file_refs).toEqual(['src/auth/session.ts']);
  });

  it('a risk with file_refs: [] to begin with always stays valid', () => {
    const risks = [risk({ title: 'No tests added', file_refs: [] })];
    const result = filterRiskFileRefs(risks, filePaths);
    expect(result).toHaveLength(1);
    expect(result[0]!.file_refs).toEqual([]);
  });

  it('null/undefined input returns []', () => {
    expect(filterRiskFileRefs(null, filePaths)).toEqual([]);
    expect(filterRiskFileRefs(undefined, filePaths)).toEqual([]);
  });
});
