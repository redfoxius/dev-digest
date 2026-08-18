import type { Container } from '../../platform/container.js';
import type { UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import * as schema from '../../db/schema.js';
import type { ReviewRepository, PullRow } from './repository.js';
import { DiffUnavailableError } from '../../platform/errors.js';

/**
 * Load the unified diff for a PR — three self-heal layers, in order
 * (docs/pr-diff-reindex-plan.md; fixes the PR #18 false-clean-verdict bug):
 *
 *   1. Active reindex: best-effort `fetchPullHead()` (fetches `pull/<n>/head`
 *      straight into the local clone) before the real `git diff base...head`
 *      attempt — covers a clone that predates this PR (headSha never fetched).
 *   2. Live GitHub refresh: best-effort `container.pullsSync.refreshFromGitHub`
 *      (repopulates `pr_files`), then reconstruct a synthetic diff from those
 *      patches — covers a clone that's unreachable/missing entirely, as long
 *      as a GitHub token is configured. Same capability `pulls/routes.ts`'s
 *      `GET /pulls/:id` uses, via the shared `container.pullsSync` getter
 *      (not a direct cross-module import — see platform/container.ts).
 *   3. Fail loud: if the diff is STILL empty after both self-heal attempts,
 *      throw `DiffUnavailableError` instead of silently handing the reviewer
 *      zero files (which produced PR #18's false `approve`/100/0-findings
 *      verdict). This intentionally also fails a PR that genuinely has zero
 *      changed files — see the plan's accepted trade-off.
 */
export async function loadDiff(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: PullRow,
  repoRow: typeof schema.repos.$inferSelect,
): Promise<UnifiedDiff> {
  const repoRef = { owner: repoRow.owner, name: repoRow.name };

  // Layer 1 — best-effort active reindex. Swallowed: the clone may not exist
  // yet, or the remote may be unreachable; the `git diff` attempt right below
  // surfaces its own failure either way, so nothing is lost by not checking.
  try {
    await container.git.fetchPullHead(repoRef, pull.number);
  } catch {
    /* best-effort — git diff below surfaces its own failure */
  }

  try {
    const diff = await container.git.diff(repoRef, pull.base, pull.headSha);
    if (diff.files.length > 0) return diff;
  } catch {
    /* fall through to Layer 2 */
  }

  // Layer 2 — best-effort live GitHub refresh, same non-fatal "no token /
  // GitHub unreachable" contract as pulls/routes.ts's existing offline
  // fallback (routes.ts's own try/catch around this same call).
  try {
    await container.pullsSync.refreshFromGitHub(repoRow, pull);
  } catch {
    /* best-effort — Layer 3 below catches a still-empty diff */
  }
  const diff = await diffFromPrFiles(repo, pull.id);
  if (diff.files.length > 0) return diff;

  // Layer 3 — fail loud. Both self-heal layers were attempted and the diff is
  // still empty; refuse to hand it to the reviewer silently.
  throw new DiffUnavailableError(repoRow.owner, repoRow.name, pull.number);
}

/** Reconstruct a UnifiedDiff from persisted pr_files patches. */
export async function diffFromPrFiles(repo: ReviewRepository, prId: string): Promise<UnifiedDiff> {
  const files = await repo.getPrFiles(prId);
  const parts: string[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parseUnifiedDiff(parts.join('\n'));
}
