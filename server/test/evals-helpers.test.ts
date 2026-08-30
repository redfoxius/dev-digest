import { describe, expect, it } from 'vitest';
import { scopeDiffToFiles } from '../src/modules/evals/helpers.js';

const TWO_FILE_DIFF = [
  'diff --git a/src/config.ts b/src/config.ts',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -10,2 +10,3 @@',
  ' export const config = {',
  '+  stripeKey: "sk_live_x",',
  ' };',
  'diff --git a/src/unrelated.ts b/src/unrelated.ts',
  '--- a/src/unrelated.ts',
  '+++ b/src/unrelated.ts',
  '@@ -1,1 +1,2 @@',
  ' export const x = 1;',
  '+export const y = 2;',
].join('\n');

describe('scopeDiffToFiles', () => {
  it('keeps only the requested file\'s section out of a multi-file diff', () => {
    const scoped = scopeDiffToFiles(TWO_FILE_DIFF, ['src/config.ts']);
    expect(scoped).toContain('src/config.ts');
    expect(scoped).toContain('stripeKey');
    expect(scoped).not.toContain('unrelated.ts');
  });

  it('falls back to the full raw diff when no file matches', () => {
    const scoped = scopeDiffToFiles(TWO_FILE_DIFF, ['src/does-not-exist.ts']);
    expect(scoped).toBe(TWO_FILE_DIFF);
  });

  it('returns the raw diff unchanged when filePaths is empty', () => {
    expect(scopeDiffToFiles(TWO_FILE_DIFF, [])).toBe(TWO_FILE_DIFF);
  });

  it('keeps multiple requested files, dropping the rest', () => {
    const threeFileDiff = [
      TWO_FILE_DIFF,
      'diff --git a/src/third.ts b/src/third.ts',
      '--- a/src/third.ts',
      '+++ b/src/third.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ].join('\n');
    const scoped = scopeDiffToFiles(threeFileDiff, ['src/config.ts', 'src/third.ts']);
    expect(scoped).toContain('config.ts');
    expect(scoped).toContain('third.ts');
    expect(scoped).not.toContain('unrelated.ts');
  });
});
