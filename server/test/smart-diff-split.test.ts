import { describe, it, expect } from 'vitest';
import { computeProposedSplits } from '../src/modules/smart-diff/split.js';

/**
 * Unit coverage for Phase 6's deterministic `split_suggestion` clustering
 * (docs/smart-diff-plan.md) — pure function, no DB, no LLM. `coreFilePaths`
 * mirrors what `SmartDiffService` derives from `classifyFile()` (Phase 1),
 * already filtered to `core`-role files in `pr_files` order.
 */
describe('computeProposedSplits', () => {
  it('returns [] for an empty core-file set (nothing to cluster)', () => {
    expect(computeProposedSplits([], [])).toEqual([]);
    expect(
      computeProposedSplits([], [{ fromFile: 'a.ts', toFile: 'b.ts' }]),
    ).toEqual([]);
  });

  it('groups edge-connected core files into one component, named by their common directory prefix', () => {
    const coreFiles = ['src/api/handler.ts', 'src/api/router.ts'];
    const edges = [{ fromFile: 'src/api/handler.ts', toFile: 'src/api/router.ts' }];

    expect(computeProposedSplits(coreFiles, edges)).toEqual([
      { name: 'src/api', files: ['src/api/handler.ts', 'src/api/router.ts'] },
    ]);
  });

  it('filters out edges touching a non-core file (wiring/boilerplate excluded from clustering)', () => {
    const coreFiles = ['src/api/handler.ts', 'src/api/router.ts'];
    const edges = [
      { fromFile: 'src/api/handler.ts', toFile: 'src/api/router.ts' },
      // Both point at files NOT in the core set — must not merge components
      // or otherwise influence the result.
      { fromFile: 'src/api/handler.ts', toFile: 'package.json' },
      { fromFile: 'index.ts', toFile: 'src/api/router.ts' },
    ];

    expect(computeProposedSplits(coreFiles, edges)).toEqual([
      { name: 'src/api', files: ['src/api/handler.ts', 'src/api/router.ts'] },
    ]);
  });

  it('a core file with no edges to any other core file becomes its own singleton component, named by its OWN filename (not its directory)', () => {
    const coreFiles = ['src/api/handler.ts', 'src/utils/logger.ts'];
    const edges: { fromFile: string; toFile: string }[] = [];

    expect(computeProposedSplits(coreFiles, edges)).toEqual([
      { name: 'handler.ts', files: ['src/api/handler.ts'] },
      { name: 'logger.ts', files: ['src/utils/logger.ts'] },
    ]);
  });

  it('multiple unconnected singletons sharing a directory get DISTINCT names, not the same directory label', () => {
    // Regression for a real bug: a singleton's "common directory prefix" is
    // trivially its own full directory, so naming singletons that way made
    // every unconnected file in the same folder (e.g. a component + its
    // test + its styles/constants, none importing each other) render as
    // several chips with an IDENTICAL label — indistinguishable duplicates
    // in the split_suggestion banner.
    const coreFiles = [
      'client/src/.../IntentCard/IntentCard.tsx',
      'client/src/.../IntentCard/IntentCard.test.tsx',
      'client/src/.../IntentCard/constants.ts',
      'client/src/.../IntentCard/styles.ts',
    ];
    const edges: { fromFile: string; toFile: string }[] = [];

    const names = computeProposedSplits(coreFiles, edges).map((s) => s.name);
    expect(names).toEqual(['IntentCard.tsx', 'IntentCard.test.tsx', 'constants.ts', 'styles.ts']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('disambiguates two unrelated singletons that happen to share a basename, by growing each name with parent-directory context', () => {
    // Regression for a real bug: two DIFFERENT `styles.ts` files (and two
    // different `INSIGHTS.md` files) in unrelated folders, with no import
    // edge between them, both named themselves just "styles.ts"/
    // "INSIGHTS.md" — indistinguishable chips even though each points at a
    // different file.
    const coreFiles = [
      'client/.../IntentCard/styles.ts',
      'client/.../PrBriefBanner/styles.ts',
      'client/INSIGHTS.md',
      'server/INSIGHTS.md',
    ];
    const edges: { fromFile: string; toFile: string }[] = [];

    const names = computeProposedSplits(coreFiles, edges).map((s) => s.name);
    expect(names).toEqual([
      'IntentCard/styles.ts',
      'PrBriefBanner/styles.ts',
      'client/INSIGHTS.md',
      'server/INSIGHTS.md',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a singleton whose basename is unique keeps the plain filename (no unnecessary parent-directory noise)', () => {
    const coreFiles = ['client/.../IntentCard/IntentCard.tsx', 'server/src/modules/pulls/routes.ts'];
    const edges: { fromFile: string; toFile: string }[] = [];

    expect(computeProposedSplits(coreFiles, edges).map((s) => s.name)).toEqual([
      'IntentCard.tsx',
      'routes.ts',
    ]);
  });

  it('falls back to a filename-based name when a REAL multi-file component only shares a one-segment (top-level) directory prefix', () => {
    // Regression for a real bug: a connected component spanning several
    // unrelated modules under the same top-level package (e.g. `server`)
    // had its common prefix collapse all the way up to just that top-level
    // segment — a name true of nearly every file in the package, not a
    // distinguishing label for this specific cluster.
    const coreFiles = [
      'server/src/modules/pulls/routes.ts',
      'server/src/db/schema/reviews.ts',
      'server/test/pulls.it.test.ts',
    ];
    const edges = [
      { fromFile: 'server/src/modules/pulls/routes.ts', toFile: 'server/src/db/schema/reviews.ts' },
      { fromFile: 'server/src/db/schema/reviews.ts', toFile: 'server/test/pulls.it.test.ts' },
    ];

    // Common prefix across all three is just "server" (1 segment) — too
    // shallow to be trusted, so this falls back to filename-based naming.
    expect(computeProposedSplits(coreFiles, edges)).toEqual([
      { name: 'routes.ts +2', files: coreFiles },
    ]);
  });

  it('falls back to a filename-based name when a component has no common directory prefix', () => {
    // Two components, neither with a usable common prefix:
    //  - a root-level singleton (no directory at all) → its own basename
    //  - two connected files in entirely different top-level directories →
    //    first file's basename + a "+N" count of the rest
    const coreFiles = ['README.md', 'src/a/one.ts', 'lib/b/two.ts'];
    const edges = [{ fromFile: 'src/a/one.ts', toFile: 'lib/b/two.ts' }];

    expect(computeProposedSplits(coreFiles, edges)).toEqual([
      { name: 'README.md', files: ['README.md'] },
      { name: 'one.ts +1', files: ['src/a/one.ts', 'lib/b/two.ts'] },
    ]);
  });

  it('component order is deterministic by first-file position in coreFilePaths', () => {
    const coreFiles = ['z/first.ts', 'a/second.ts', 'root1.ts', 'root2.ts'];
    const edges: { fromFile: string; toFile: string }[] = [];

    expect(computeProposedSplits(coreFiles, edges)).toEqual([
      { name: 'first.ts', files: ['z/first.ts'] },
      { name: 'second.ts', files: ['a/second.ts'] },
      { name: 'root1.ts', files: ['root1.ts'] },
      { name: 'root2.ts', files: ['root2.ts'] },
    ]);
  });
});
