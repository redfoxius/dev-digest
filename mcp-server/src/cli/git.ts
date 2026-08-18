import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Runs one `git` subcommand and returns trimmed stdout. Injectable for tests. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export const realGitRunner: GitRunner = async (args, cwd) => {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
};

export class GitError extends Error {}

/** `git rev-parse --show-toplevel` from `cwd`. Throws GitError outside a repo. */
export async function findGitRoot(cwd: string, run: GitRunner = realGitRunner): Promise<string> {
  try {
    const out = await run(['rev-parse', '--show-toplevel'], cwd);
    return out.trim();
  } catch (err) {
    throw new GitError(`Not a git repository (or any parent up to mount point): ${cwd}`, {
      cause: err,
    });
  }
}

/**
 * `git diff HEAD` — staged + unstaged changes to TRACKED files. Untracked
 * files never appear here (git's own contract, not a limitation this CLI
 * adds) — see listUntrackedFiles() for the honest disclosure of what's
 * excluded.
 */
export async function getWorkingDiff(root: string, run: GitRunner = realGitRunner): Promise<string> {
  try {
    return await run(['diff', 'HEAD'], root);
  } catch (err) {
    throw new GitError('Failed to run `git diff HEAD`', { cause: err });
  }
}

/** Untracked file paths (`git status --porcelain=v1`'s `??` entries). */
export async function listUntrackedFiles(root: string, run: GitRunner = realGitRunner): Promise<string[]> {
  const out = await run(['status', '--porcelain=v1'], root);
  return out
    .split('\n')
    .filter((line) => line.startsWith('??'))
    .map((line) => line.slice(3).trim())
    .filter((p) => p.length > 0);
}
