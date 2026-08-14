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

  it('a core file with no edges to any other core file becomes its own singleton component', () => {
    const coreFiles = ['src/api/handler.ts', 'src/utils/logger.ts'];
    const edges: { fromFile: string; toFile: string }[] = [];

    expect(computeProposedSplits(coreFiles, edges)).toEqual([
      { name: 'src/api', files: ['src/api/handler.ts'] },
      { name: 'src/utils', files: ['src/utils/logger.ts'] },
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
      { name: 'z', files: ['z/first.ts'] },
      { name: 'a', files: ['a/second.ts'] },
      { name: 'root1.ts', files: ['root1.ts'] },
      { name: 'root2.ts', files: ['root2.ts'] },
    ]);
  });
});
