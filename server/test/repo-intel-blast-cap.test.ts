import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { FullSymbolRow, RepoBasics, ResolvedCallerRow } from '../src/modules/repo-intel/repository.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';

/**
 * `getBlastRadius`'s persistent path (`tryPersistentBlast`) used to cap the
 * WHOLE PR's caller list at `MAX_CALLERS_PER_SYMBOL` globally, despite the
 * constant's own name/doc saying "per changed symbol" — found via
 * docs/blast-radius-plan.md's live verification (a 193-symbol PR showed 0
 * callers for ~180 of them because one or two symbols' high-rank callers
 * exhausted the entire budget). This locks in the fix: the cap applies per
 * `viaSymbol`, so a symbol with many callers can't starve another symbol's
 * allotment.
 *
 * No Postgres — `repo` (RepoIntelRepository) is patched directly, same
 * injection pattern as repo-intel-facade-degraded.test.ts.
 */
function buildService(opts: {
  changedFileSymbols: FullSymbolRow[];
  resolvedCallers: ResolvedCallerRow[];
}): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getRepoBasics: async (): Promise<RepoBasics | null> => null,
    tryGetIndexState: async (): Promise<IndexState> => ({
      repoId: 'r1',
      status: 'full',
      filesIndexed: 1,
      filesSkipped: 0,
      durationMs: 0,
      lastIndexedSha: 'abc',
      indexerVersion: 2,
      languages: ['typescript'],
      updatedAt: new Date(),
    }),
    getSymbolRows: async (_repoId: string, paths: string[]): Promise<FullSymbolRow[]> =>
      opts.changedFileSymbols.filter((s) => paths.includes(s.path)),
    getResolvedCallers: async (): Promise<ResolvedCallerRow[]> => opts.resolvedCallers,
    getFileFacts: async () => [],
  };
  return svc;
}

const CHANGED_FILE = 'foo.ts';

describe('getBlastRadius persistent path — per-symbol caller cap', () => {
  it('caps callers per changed symbol, not globally across the PR', async () => {
    const changedFileSymbols: FullSymbolRow[] = [
      { path: CHANGED_FILE, name: 'heavy', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
      { path: CHANGED_FILE, name: 'light', kind: 'function', line: 4, endLine: 5, exported: true, signature: null },
    ];

    // 'heavy' has more resolved callers than the per-symbol cap; 'light' has
    // only 3. Ranks put every 'heavy' caller ahead of every 'light' caller,
    // so a global top-N-by-rank cap would starve 'light' entirely.
    const heavyCallers: ResolvedCallerRow[] = Array.from({ length: MAX_CALLERS_PER_SYMBOL + 5 }, (_, i) => ({
      fromPath: `caller-heavy-${i}.ts`,
      toSymbol: 'heavy',
      line: 10,
      rank: 100 - i,
    }));
    const lightCallers: ResolvedCallerRow[] = Array.from({ length: 3 }, (_, i) => ({
      fromPath: `caller-light-${i}.ts`,
      toSymbol: 'light',
      line: 20,
      rank: 50 - i,
    }));

    const svc = buildService({ changedFileSymbols, resolvedCallers: [...heavyCallers, ...lightCallers] });
    const blast = await svc.getBlastRadius('r1', [CHANGED_FILE]);

    expect(blast.degraded).toBeFalsy();
    expect(blast.changedSymbols.map((s) => s.name).sort()).toEqual(['heavy', 'light']);

    const heavyResult = blast.callers.filter((c) => c.viaSymbol === 'heavy');
    const lightResult = blast.callers.filter((c) => c.viaSymbol === 'light');

    expect(heavyResult).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    // The bug this test guards against: a global cap would leave this empty.
    expect(lightResult).toHaveLength(3);
    // Per-symbol cap keeps the highest-rank callers within that symbol's own
    // allotment (ranks 100..81 survive, 96..76 dropped for 'heavy').
    expect(heavyResult.every((c) => c.rank >= 100 - MAX_CALLERS_PER_SYMBOL + 1)).toBe(true);
  });
});
