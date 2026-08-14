import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { PrMeta, PrDetail, GitHubClient, PrReviewComment } from '@devdigest/shared';
import { PrCommentInput } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { deriveReviewStatus, rollupSeverities, worstVerdict } from './status.js';

/**
 * F1 — pulls module. PR import via Octokit (list + per-PR detail).
 *   GET /repos/:id/pulls → list PRs for a repo (open + recently merged/closed,
 *                          synced from GitHub, persisted). `status` is GitHub's
 *                          merge state (open/merged/closed).
 *   GET /pulls/:id       → full PR detail (diff/files, commits, body, linked issue)
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL
 * and owned by A2 — this module only imports/reads.
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(container, req);
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
    if (!repo) throw new NotFoundError('Repo not found');

    let gh: GitHubClient | null = null;
    try {
      gh = await container.github();
    } catch (err) {
      app.log.warn({ err }, 'GitHub client unavailable (no token / offline); serving persisted PRs');
    }

    // Local-first: sync from GitHub when a token is configured, but never
    // fail the read — already-imported/seeded PRs stay viewable offline.
    if (gh) {
      try {
        const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
        for (const pr of pulls) {
          await container.db
            .insert(t.pullRequests)
            .values({
              workspaceId,
              repoId: repo.id,
              number: pr.number,
              title: pr.title,
              author: pr.author,
              branch: pr.branch,
              base: pr.base,
              headSha: pr.head_sha,
              additions: pr.additions,
              deletions: pr.deletions,
              filesCount: pr.files_count,
              status: pr.status,
              openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
              updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
            })
            .onConflictDoUpdate({
              target: [t.pullRequests.repoId, t.pullRequests.number],
              set: {
                title: pr.title,
                headSha: pr.head_sha,
                status: pr.status,
                updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
              },
            });
        }
      } catch (err) {
        app.log.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    const rows = await container.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo.id));

    // Diff stats aren't on GitHub's PR-list payload, so freshly-imported PRs
    // land with zeroed size/diff. Backfill them once from the detail endpoint
    // so the list shows real S/M/L + ± counts. Capped per request (each backfill
    // is a detail fetch) — the periodic refetch chips away at any remainder.
    const BACKFILL_LIMIT = 10;
    if (gh) {
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, BACKFILL_LIMIT);
      for (const r of needStats) {
        try {
          const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
          await container.db
            .update(t.pullRequests)
            .set({
              additions: detail.additions,
              deletions: detail.deletions,
              filesCount: detail.files_count,
            })
            .where(eq(t.pullRequests.id, r.id));
          r.additions = detail.additions;
          r.deletions = detail.deletions;
          r.filesCount = detail.files_count;
        } catch (err) {
          app.log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    }

    // Total COST across ALL agent runs ever executed for each PR, plus the
    // "last (total)" figure — cost of every agent run belonging to the LAST
    // review ACTION (one `POST /pulls/:id/review` call may run several
    // agents at once; they all share `multi_agent_run_id`). Picking a single
    // most-recent `agent_runs` row here would silently drop every sibling
    // agent's cost whenever one agent happens to finish last — the batch key
    // (`multiAgentRunId ?? id`) is what makes "the last run" mean "the whole
    // last action" instead of "whichever row's ranAt sorts highest". Rows
    // created before the `multi_agent_run_id` column existed have no batch
    // id and fall back to being their own singleton batch (unchanged legacy
    // behavior). Computed on read (no FK denorm), one IN-query + JS grouping,
    // same idiom as the findings aggregation below.
    const prIds = rows.map((r) => r.id);
    const costByPr = new Map<string, number>();
    const latestRunBatchKeyByPr = new Map<string, string>();
    const latestRunCostByPr = new Map<string, number>();
    // agent_runs.id → its batch key, reused below to key each REVIEW's batch
    // via reviews.runId (a review has no multi_agent_run_id of its own).
    const runBatchKeyById = new Map<string, string>();
    if (prIds.length > 0) {
      const costRows = await container.db
        .select({
          id: t.agentRuns.id,
          prId: t.agentRuns.prId,
          costUsd: t.agentRuns.costUsd,
          multiAgentRunId: t.agentRuns.multiAgentRunId,
        })
        .from(t.agentRuns)
        .where(inArray(t.agentRuns.prId, prIds))
        .orderBy(desc(t.agentRuns.ranAt));
      for (const run of costRows) {
        const batchKey = run.multiAgentRunId ?? run.id;
        runBatchKeyById.set(run.id, batchKey);
        if (!run.prId) continue;
        if (run.costUsd != null) {
          costByPr.set(run.prId, (costByPr.get(run.prId) ?? 0) + run.costUsd);
        }
        // Rows are newest-first → the first row seen per PR pins that PR's
        // latest-batch key (it IS the newest run, so it's part of its own
        // latest batch by definition).
        if (!latestRunBatchKeyByPr.has(run.prId)) latestRunBatchKeyByPr.set(run.prId, batchKey);
        if (batchKey === latestRunBatchKeyByPr.get(run.prId) && run.costUsd != null) {
          latestRunCostByPr.set(run.prId, (latestRunCostByPr.get(run.prId) ?? 0) + run.costUsd);
        }
      }
    }

    // Latest-review-ACTION SCORE + ids per PR (same batch concept as cost
    // above). SCORE is the MINIMUM (worst) score across every review in the
    // PR's latest batch — not the literal most-recent row. Picking a single
    // row let a clean agent that happened to finish last (e.g. score 100)
    // mask another agent in the SAME batch that actually rejected the PR
    // (e.g. score 6) — the list would read "100" while a real blocker
    // exists. FINDINGS ids collect every review from that PR's latest
    // batch, so the severity rollup below sums across all agents from the
    // last "Run Review" click instead of picking whichever agent's review
    // happened to be inserted last.
    const latestReviewScoresByPr = new Map<string, number[]>();
    const latestReviewBatchKeyByPr = new Map<string, string>();
    const latestReviewIdsByPr = new Map<string, string[]>();
    if (prIds.length > 0) {
      const reviewRows = await container.db
        .select({
          id: t.reviews.id,
          prId: t.reviews.prId,
          runId: t.reviews.runId,
          score: t.reviews.score,
        })
        .from(t.reviews)
        .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
        .orderBy(desc(t.reviews.createdAt));
      // Rows are newest-first → first seen per PR pins its latest-batch key.
      // A review whose run isn't in runBatchKeyById (or has no runId at
      // all) is its own singleton batch, keyed by its own id — matches the
      // agent_runs fallback above.
      for (const rv of reviewRows) {
        const batchKey = (rv.runId && runBatchKeyById.get(rv.runId)) ?? rv.id;
        if (!latestReviewBatchKeyByPr.has(rv.prId)) latestReviewBatchKeyByPr.set(rv.prId, batchKey);
        if (batchKey === latestReviewBatchKeyByPr.get(rv.prId)) {
          const idArr = latestReviewIdsByPr.get(rv.prId);
          if (idArr) idArr.push(rv.id);
          else latestReviewIdsByPr.set(rv.prId, [rv.id]);
          // A review with an unknown score (null) doesn't drag the batch's
          // worst-case down — only known scores compete for the minimum.
          if (rv.score != null) {
            const scoreArr = latestReviewScoresByPr.get(rv.prId);
            if (scoreArr) scoreArr.push(rv.score);
            else latestReviewScoresByPr.set(rv.prId, [rv.score]);
          }
        }
      }
    }
    const latestReviewScoreByPr = new Map<string, number>();
    for (const [prId, scores] of latestReviewScoresByPr) {
      latestReviewScoreByPr.set(prId, Math.min(...scores));
    }

    // Live per-severity FINDINGS breakdown, summed across every review in
    // each PR's latest batch (not across ALL history — a finding an agent
    // already flagged in an older run still isn't double-counted, since only
    // the latest batch's review ids are in this query). "Live" means
    // dismissed findings are excluded at read time, not snapshotted, so
    // accepting/dismissing a finding is reflected on the next list fetch.
    const allLatestReviewIds = [...latestReviewIdsByPr.values()].flat();
    const findingsByReview = new Map<string, { severity: string }[]>();
    if (allLatestReviewIds.length > 0) {
      const findingRows = await container.db
        .select({ reviewId: t.findings.reviewId, severity: t.findings.severity })
        .from(t.findings)
        .where(
          and(inArray(t.findings.reviewId, allLatestReviewIds), isNull(t.findings.dismissedAt)),
        );
      for (const f of findingRows) {
        const arr = findingsByReview.get(f.reviewId);
        if (arr) arr.push(f);
        else findingsByReview.set(f.reviewId, [f]);
      }
    }

    const now = Date.now();
    return rows.map((r) => {
      const reviewIds = latestReviewIdsByPr.get(r.id);
      return {
        id: r.id,
        number: r.number,
        title: r.title,
        author: r.author,
        branch: r.branch,
        base: r.base,
        head_sha: r.headSha,
        additions: r.additions,
        deletions: r.deletions,
        files_count: r.filesCount,
        status: deriveReviewStatus({
          ghStatus: r.status,
          lastReviewedSha: r.lastReviewedSha,
          headSha: r.headSha,
          updatedAt: r.updatedAt,
          now,
        }),
        opened_at: r.openedAt?.toISOString() ?? null,
        updated_at: r.updatedAt?.toISOString() ?? null,
        score: latestReviewScoreByPr.get(r.id) ?? null,
        cost_usd: costByPr.get(r.id) ?? null,
        latest_run_cost_usd: latestRunCostByPr.get(r.id) ?? null,
        latest_review_ids: reviewIds ?? null,
        findings: reviewIds
          ? rollupSeverities(reviewIds.flatMap((id) => findingsByReview.get(id) ?? []))
          : null,
      };
    });
  });

  app.get('/pulls/:id', { schema: { params: IdParams } }, async (req): Promise<PrDetail> => {
    const { workspaceId } = await getContext(container, req);
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(
        and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, req.params.id)),
      );
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');

    // PR Brief aggregate (Phase 2) — computed ONCE here, shared by both the
    // live-refresh and offline-fallback return branches below (never
    // hand-duplicated), reusing the SAME latest-batch reviewIds
    // `getLatestReviewBatchFindings` already resolves elsewhere in this app.
    const { reviewIds, findings: latestFindings } =
      await container.reviewRepo.getLatestReviewBatchFindings(pr.id);
    const batchReviews = await container.reviewRepo.getReviewsByIds(reviewIds);
    const scores = batchReviews.map((r) => r.score).filter((s): s is number => s != null);
    const costs = batchReviews.map((r) => r.costUsd).filter((c): c is number => c != null);
    const prBrief = {
      score: scores.length > 0 ? Math.min(...scores) : null,
      latest_run_cost_usd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
      findings: reviewIds.length > 0 ? rollupSeverities(latestFindings) : null,
      verdict: worstVerdict(batchReviews.map((r) => r.verdict)),
    };

    // Local-first: refresh detail from GitHub when a token is configured;
    // otherwise serve the persisted files/commits/body (seeded or previously
    // imported) so PR detail works offline.
    try {
      const gh = await container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);

      await container.db.delete(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      if (detail.files.length > 0) {
        await container.db.insert(t.prFiles).values(
          detail.files.map((f) => ({
            prId: pr.id,
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
        );
      }
      await container.db.delete(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      if (detail.commits.length > 0) {
        await container.db.insert(t.prCommits).values(
          detail.commits.map((c) => ({
            prId: pr.id,
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
        );
      }
      await container.db
        .update(t.pullRequests)
        .set({
          body: detail.body ?? null,
          // Diff stats aren't on GitHub's PR-list payload — backfill them from
          // the detail fetch so the Pull Requests list shows real size/files.
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        })
        .where(eq(t.pullRequests.id, pr.id));

      return { ...detail, id: pr.id, ...prBrief };
    } catch (err) {
      app.log.warn({ err }, 'GitHub PR detail refresh skipped (no token / offline); serving persisted detail');
      const files = await container.db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      const commits = await container.db.select().from(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      return {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        head_sha: pr.headSha,
        additions: pr.additions,
        deletions: pr.deletions,
        files_count: pr.filesCount,
        status: pr.status as PrDetail['status'],
        opened_at: pr.openedAt?.toISOString() ?? null,
        updated_at: pr.updatedAt?.toISOString() ?? null,
        body: pr.body ?? null,
        files: files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committed_at: c.committedAt?.toISOString() ?? null,
        })),
        ...prBrief,
      };
    }
  });

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to GitHub (no local persistence): GET reflects existing PR
  // comments; POST creates one immediately. Keeps the tab in lock-step with
  // GitHub and avoids a stale local mirror.
  async function resolvePrAndRepo(id: string, workspaceId: string) {
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, id)));
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }

  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams } },
    async (req): Promise<PrReviewComment[]> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      let gh: GitHubClient;
      try {
        gh = await container.github();
      } catch (err) {
        app.log.warn({ err }, 'GitHub client unavailable; serving no PR comments');
        return [];
      }
      try {
        return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
      } catch (err) {
        app.log.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
        return [];
      }
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      const input = req.body;
      let gh: GitHubClient;
      try {
        gh = await container.github();
      } catch {
        throw new AppError(
          'github_unavailable',
          'Connect a GitHub token to post comments.',
          400,
        );
      }
      try {
        return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pr.number, {
          commitId: pr.headSha,
          path: input.path,
          line: input.line,
          ...(input.side ? { side: input.side } : {}),
          body: input.body,
          ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
        });
      } catch (err) {
        // GitHub rejects comments on lines outside the diff / on closed PRs (422).
        const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
        throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
      }
    },
  );
}
