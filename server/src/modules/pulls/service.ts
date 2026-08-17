import type { PrDetail } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { PullRow, RepoRow } from '../../db/rows.js';
import * as pullsRepo from './repository.js';

/**
 * Layer 2 (docs/pr-diff-reindex-plan.md) — live GitHub refresh of a PR's
 * persisted detail (files/commits/body/diff stats). Extracted from
 * `pulls/routes.ts`'s inline `GET /pulls/:id` logic so `diff-loader.ts`'s
 * self-heal fallback can reuse the SAME refresh instead of duplicating it.
 *
 * Wired onto `Container` as `pullsSync` (see `platform/container.ts`) —
 * modeled on `RepoIntelService`/`IntentDeriverService`: a cross-module
 * capability composing a port (`container.github()`) + a private repository,
 * constructed only in the composition root and swappable via
 * `ContainerOverrides.pullsSync` in tests. Both `diff-loader.ts` and
 * `pulls/routes.ts` call `container.pullsSync.refreshFromGitHub(...)` —
 * neither imports the other's module directly (an earlier draft of this
 * plan did, and an architecture-reviewer pass flagged it as bypassing the
 * composition root).
 */
export interface PullsSync {
  /**
   * Fetch a PR's live detail from GitHub and persist it (files/commits/body/
   * diff stats), returning the fetched `PrDetail`. Throws on any failure
   * (GitHub call, DB write) — swallowing a failure (no token / offline) is
   * the CALLER's decision, not this service's; see both call sites'
   * try/catch (`pulls/routes.ts`, `diff-loader.ts`).
   */
  refreshFromGitHub(repo: RepoRow, pull: PullRow): Promise<PrDetail>;
}

export class PullsSyncService implements PullsSync {
  constructor(private container: Container) {}

  async refreshFromGitHub(repo: RepoRow, pull: PullRow): Promise<PrDetail> {
    const gh = await this.container.github();
    const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pull.number);

    await pullsRepo.replacePrFiles(this.container.db, pull.id, detail.files);
    await pullsRepo.replacePrCommits(this.container.db, pull.id, detail.commits);
    await pullsRepo.updatePrDetailFields(this.container.db, pull.id, {
      body: detail.body ?? null,
      additions: detail.additions,
      deletions: detail.deletions,
      filesCount: detail.files_count,
    });

    return detail;
  }
}
