import { describe, it, expect, vi } from 'vitest';
import { findGitRoot, getWorkingDiff, listUntrackedFiles, GitError } from '../../src/cli/git.js';

describe('cli/git', () => {
  it('findGitRoot returns the trimmed rev-parse output', async () => {
    const run = vi.fn().mockResolvedValue('/repo/root\n');
    await expect(findGitRoot('/repo/root/sub', run)).resolves.toBe('/repo/root');
    expect(run).toHaveBeenCalledWith(['rev-parse', '--show-toplevel'], '/repo/root/sub');
  });

  it('findGitRoot wraps a failure as GitError (outside a repo)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('not a git repository'));
    await expect(findGitRoot('/tmp', run)).rejects.toBeInstanceOf(GitError);
  });

  it('getWorkingDiff runs `git diff HEAD`', async () => {
    const run = vi.fn().mockResolvedValue('diff --git a/x b/x\n');
    await expect(getWorkingDiff('/repo', run)).resolves.toContain('diff --git');
    expect(run).toHaveBeenCalledWith(['diff', 'HEAD'], '/repo');
  });

  it('getWorkingDiff wraps a failure as GitError', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(getWorkingDiff('/repo', run)).rejects.toBeInstanceOf(GitError);
  });

  it('listUntrackedFiles extracts only ?? entries, trimmed', async () => {
    const run = vi.fn().mockResolvedValue(' M tracked.ts\n?? new-file.ts\n?? dir/other.ts\n');
    await expect(listUntrackedFiles('/repo', run)).resolves.toEqual(['new-file.ts', 'dir/other.ts']);
  });

  it('listUntrackedFiles returns [] on a clean tree', async () => {
    const run = vi.fn().mockResolvedValue('');
    await expect(listUntrackedFiles('/repo', run)).resolves.toEqual([]);
  });
});
