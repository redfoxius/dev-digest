import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrFile, PrCommit } from '@devdigest/shared';

/**
 * pulls module data-access — DB writes for a live GitHub refresh of a PR's
 * persisted detail (files/commits/diff-stats/body). Private to this module:
 * only `pulls/service.ts` imports it (onion-architecture: no `db.insert`/
 * `db.delete`/`db.update` for these tables outside this file).
 *
 * Split from `reviews/repository.ts` (rather than folded into
 * `reviews/repository/pull.repo.ts`) because that repository's documented
 * ownership (`reviews/repository.ts:6-7`) is reviews/findings/pr_intent/
 * agent_runs/run_traces — it already only *reads* `pr_files`/`pr_commits`
 * for the review flow. Writing them on a live GitHub sync belongs here.
 *
 * Query shapes are lifted verbatim (no behavior change) from the inline
 * delete+insert/update calls `pulls/routes.ts`'s `GET /pulls/:id` used to do
 * directly — see docs/pr-diff-reindex-plan.md Work Item 2.
 */

/** Replace a PR's persisted files wholesale (delete + insert) — a live
 *  GitHub fetch has no concept of an incremental file diff to merge against.
 *  Wrapped in a transaction: an unwrapped delete+insert left the PR with
 *  zero persisted files if the insert failed after the delete committed
 *  (pr-self-review finding on PR #18 — a real data-loss bug, not a style
 *  preference; see the drizzle-orm-patterns skill's transaction guidance). */
export async function replacePrFiles(db: Db, prId: string, files: PrFile[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
    if (files.length === 0) return;
    await tx.insert(t.prFiles).values(
      files.map((f) => ({
        prId,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      })),
    );
  });
}

/** Replace a PR's persisted commits wholesale (delete + insert). Same
 *  transaction fix as `replacePrFiles` above. */
export async function replacePrCommits(db: Db, prId: string, commits: PrCommit[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
    if (commits.length === 0) return;
    await tx.insert(t.prCommits).values(
      commits.map((c) => ({
        prId,
        sha: c.sha,
        message: c.message,
        author: c.author,
        committedAt: c.committed_at ? new Date(c.committed_at) : null,
      })),
    );
  });
}

/**
 * Backfill detail fields not present on GitHub's PR-list payload (body +
 * diff stats), so the Pull Requests list shows real size/± counts after a
 * detail fetch.
 */
export async function updatePrDetailFields(
  db: Db,
  prId: string,
  fields: { body: string | null; additions: number; deletions: number; filesCount: number },
): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({
      body: fields.body,
      additions: fields.additions,
      deletions: fields.deletions,
      filesCount: fields.filesCount,
    })
    .where(eq(t.pullRequests.id, prId));
}
