import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { findGitRoot, getWorkingDiff, listUntrackedFiles, GitError } from '../git.js';
import { readSecret } from '../secrets.js';
import { runWorkingReview } from '../review.js';
import { printFindings, exitCodeForFindings, EXIT_OK, EXIT_REVIEW_FAILED } from '../output.js';

/**
 * `devdigest review --mode working` — review the local working tree (staged +
 * unstaged changes to tracked files) with the same reviewer server/ uses for
 * a PR. See docs/cli-working-review-plan.md for the full contract.
 */
export async function runWorkingMode(cwd: string): Promise<number> {
  let root: string;
  try {
    root = await findGitRoot(cwd);
  } catch (err) {
    console.error(err instanceof GitError ? err.message : String(err));
    return EXIT_REVIEW_FAILED;
  }

  const untracked = await listUntrackedFiles(root).catch(() => []);
  if (untracked.length > 0) {
    console.warn(
      `WARNING: ${untracked.length} untracked file(s) are NOT included in this review ` +
        '(`git diff HEAD` only covers tracked files): ' +
        untracked.slice(0, 10).join(', ') +
        (untracked.length > 10 ? `, +${untracked.length - 10} more` : ''),
    );
  }

  let diffRaw: string;
  try {
    diffRaw = await getWorkingDiff(root);
  } catch (err) {
    console.error(err instanceof GitError ? err.message : String(err));
    return EXIT_REVIEW_FAILED;
  }

  if (diffRaw.trim().length === 0) {
    console.log('No local changes to review.');
    return EXIT_OK;
  }

  const apiKey = await readSecret('OPENROUTER_API_KEY');
  if (!apiKey) {
    console.error(
      'OPENROUTER_API_KEY is not configured — set it in ~/.devdigest/secrets.json or the environment.',
    );
    return EXIT_REVIEW_FAILED;
  }

  try {
    const llm = new OpenRouterProvider(apiKey);
    const outcome = await runWorkingReview(diffRaw, llm);
    console.log(`Verdict: ${outcome.review.verdict} · score ${outcome.review.score} · grounding ${outcome.grounding}`);
    printFindings(outcome.review.findings);
    return exitCodeForFindings(outcome.review.findings);
  } catch (err) {
    console.error(`Review failed: ${(err as Error).message}`);
    return EXIT_REVIEW_FAILED;
  }
}
