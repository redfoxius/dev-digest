/**
 * Smart Diff (Phase 2 of docs/smart-diff-plan.md) — `SmartDiffService.getSmartDiff`
 * real DB-backed wiring. Runs/reviews/findings have no public "create"
 * endpoint that lets a test control batching/severity precisely, so they're
 * seeded directly via `t.*` inserts, same precedent as
 * `repo-intel-sample.it.test.ts`/`skills.it.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { SmartDiffService } from '../src/modules/smart-diff/service.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string, number: number) {
  const name = `smart-diff-fixture-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number,
      title: 'Smart diff fixture',
      author: 'fixture',
      branch: 'feat/x',
      base: 'main',
      headSha: 'deadbeef',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('SmartDiffService.getSmartDiff — real DB-backed wiring (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let service: SmartDiffService;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    const app = await buildApp({ config: config(), db: pg.handle.db });
    service = new SmartDiffService(app.container);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it(
    'groups by classified role (omitting empty roles), counts only the latest ' +
      'review batch\'s non-dismissed findings (accepted included, dismissed ' +
      'excluded), expands multi-line ranges with worse-severity-wins, and ' +
      'sorts finding_lines ascending',
    async () => {
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 900);

      // No `wiring`-shaped file in this fixture — proves the empty `wiring`
      // role is omitted from `groups[]`, not emitted empty.
      await pg.handle.db.insert(t.prFiles).values([
        { prId: pr.id, path: 'package-lock.json', additions: 40, deletions: 0 },
        { prId: pr.id, path: 'src/service.ts', additions: 30, deletions: 10 },
        { prId: pr.id, path: 'src/util.ts', additions: 2, deletions: 0 },
      ]);

      // ---- an OLDER, separate (non-batched) review — must NOT be counted --
      const [olderReview] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: pr.id,
          kind: 'review',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        })
        .returning();
      await pg.handle.db.insert(t.findings).values({
        reviewId: olderReview!.id,
        file: 'src/service.ts',
        startLine: 1,
        endLine: 1,
        severity: 'CRITICAL',
        category: 'bug',
        title: 'Old-batch finding — must not count',
        rationale: 'r',
        confidence: 0.9,
      });

      // ---- the LATEST batch: two agent_runs sharing one multi_agent_run_id -
      const [batch] = await pg.handle.db
        .insert(t.multiAgentRuns)
        .values({ workspaceId, prId: pr.id })
        .returning();
      const [runA] = await pg.handle.db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          prId: pr.id,
          multiAgentRunId: batch!.id,
          ranAt: new Date('2026-02-01T00:00:00Z'),
        })
        .returning();
      const [runB] = await pg.handle.db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          prId: pr.id,
          multiAgentRunId: batch!.id,
          ranAt: new Date('2026-02-01T00:00:01Z'),
        })
        .returning();

      const [reviewA] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: pr.id,
          runId: runA!.id,
          kind: 'review',
          createdAt: new Date('2026-02-01T00:00:00Z'),
        })
        .returning();
      // reviewB (part of the latest batch) is inserted but has no findings of
      // its own — proves a batch review with nothing to report doesn't break
      // anything for the files it didn't touch.
      await pg.handle.db.insert(t.reviews).values({
        workspaceId,
        prId: pr.id,
        runId: runB!.id,
        kind: 'review',
        createdAt: new Date('2026-02-01T00:00:01Z'),
      });

      await pg.handle.db.insert(t.findings).values([
        // A finding at a higher line number, inserted first — proves the
        // final array is explicitly sorted, not incidentally ordered.
        {
          reviewId: reviewA!.id,
          file: 'src/service.ts',
          startLine: 20,
          endLine: 20,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Trailing finding',
          rationale: 'r',
          confidence: 0.6,
        },
        // Multi-line WARNING finding, lines 10-12.
        {
          reviewId: reviewA!.id,
          file: 'src/service.ts',
          startLine: 10,
          endLine: 12,
          severity: 'WARNING',
          category: 'bug',
          title: 'Multi-line finding',
          rationale: 'r',
          confidence: 0.8,
        },
        // ACCEPTED (not dismissed) finding overlapping line 11 with a WORSE
        // severity — must still count (accepted != resolved) and must win
        // the overlap on line 11.
        {
          reviewId: reviewA!.id,
          file: 'src/service.ts',
          startLine: 11,
          endLine: 11,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Accepted overlapping finding',
          rationale: 'r',
          confidence: 0.95,
          acceptedAt: new Date('2026-02-01T01:00:00Z'),
        },
        // DISMISSED finding — must be excluded entirely.
        {
          reviewId: reviewA!.id,
          file: 'src/service.ts',
          startLine: 5,
          endLine: 5,
          severity: 'CRITICAL',
          category: 'bug',
          title: 'Dismissed finding',
          rationale: 'r',
          confidence: 0.7,
          dismissedAt: new Date('2026-02-01T01:00:00Z'),
        },
      ]);
      const result = await service.getSmartDiff(workspaceId, pr.id);

      // ---- grouping + empty-role omission ---------------------------------
      const roles = result.groups.map((g) => g.role);
      expect(roles).toEqual(['core', 'boilerplate']);
      expect(result.groups.find((g) => g.role === 'wiring')).toBeUndefined();

      const core = result.groups.find((g) => g.role === 'core')!;
      const boilerplate = result.groups.find((g) => g.role === 'boilerplate')!;
      expect(boilerplate.files.map((f) => f.path)).toEqual(['package-lock.json']);
      expect(boilerplate.files[0]!.findings_count).toBe(0);
      expect(boilerplate.files[0]!.finding_lines).toEqual([]);

      const serviceTs = core.files.find((f) => f.path === 'src/service.ts')!;
      const utilTs = core.files.find((f) => f.path === 'src/util.ts')!;

      // Old-batch (line 1, CRITICAL) and dismissed (line 5) findings excluded;
      // accepted (line 11, CRITICAL) included — 3 non-dismissed latest-batch
      // findings on this file (line-20 SUGGESTION, lines 10-12 WARNING, line
      // 11 accepted CRITICAL).
      expect(serviceTs.findings_count).toBe(3);
      expect(serviceTs.finding_lines).toEqual([
        { line: 10, severity: 'WARNING' },
        { line: 11, severity: 'CRITICAL' }, // worse severity wins the overlap
        { line: 12, severity: 'WARNING' },
        { line: 20, severity: 'SUGGESTION' },
      ]);

      expect(utilTs.findings_count).toBe(0);
      expect(utilTs.finding_lines).toEqual([]);

      // ---- split_suggestion (minimal this phase) --------------------------
      expect(result.split_suggestion.total_lines).toBe(40 + 40 + 2);
      expect(result.split_suggestion.proposed_splits).toEqual([]);
      expect(result.split_suggestion.too_big).toBe(false);
    },
  );

  it('returns empty finding_lines / findings_count: 0 before any review exists for a PR', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 901);
    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId: pr.id, path: 'src/other.ts', additions: 5, deletions: 0 });

    const result = await service.getSmartDiff(workspaceId, pr.id);

    expect(result.groups).toEqual([
      {
        role: 'core',
        files: [
          {
            path: 'src/other.ts',
            pseudocode_summary: null,
            additions: 5,
            deletions: 0,
            finding_lines: [],
            findings_count: 0,
          },
        ],
      },
    ]);
    expect(result.split_suggestion).toEqual({ too_big: false, total_lines: 5, proposed_splits: [] });
  });

  it(
    'populates pseudocode_summary from review_file_summaries scoped to the ' +
      'SAME latest-batch review ids findings are scoped to (Phase 5)',
    async () => {
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 903);
      await pg.handle.db.insert(t.prFiles).values([
        { prId: pr.id, path: 'src/service.ts', additions: 10, deletions: 0 },
        { prId: pr.id, path: 'src/other.ts', additions: 5, deletions: 0 },
      ]);

      // ---- an OLDER, separate (non-batched) review — its file summary must
      // NOT surface, same "latest batch only" rule findings already follow.
      const [olderReview] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: pr.id,
          kind: 'review',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        })
        .returning();
      await pg.handle.db.insert(t.reviewFileSummaries).values({
        reviewId: olderReview!.id,
        file: 'src/service.ts',
        summary: 'STALE — from an older, non-latest review batch.',
      });

      // ---- the latest (single-review) batch — has a summary for one file
      // only; the other changed file has none and must stay `null`.
      const [latestReview] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: pr.id,
          kind: 'review',
          createdAt: new Date('2026-02-01T00:00:00Z'),
        })
        .returning();
      await pg.handle.db.insert(t.reviewFileSummaries).values({
        reviewId: latestReview!.id,
        file: 'src/service.ts',
        summary: 'Handles the core service logic for this PR.',
      });

      const result = await service.getSmartDiff(workspaceId, pr.id);
      const core = result.groups.find((g) => g.role === 'core')!;
      const serviceTs = core.files.find((f) => f.path === 'src/service.ts')!;
      const otherTs = core.files.find((f) => f.path === 'src/other.ts')!;

      expect(serviceTs.pseudocode_summary).toBe('Handles the core service logic for this PR.');
      expect(otherTs.pseudocode_summary).toBeNull();
    },
  );

  it('throws NotFoundError for a PR outside the workspace', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 902);
    await expect(service.getSmartDiff('00000000-0000-0000-0000-000000000000', pr.id)).rejects.toThrow(
      'Pull request not found',
    );
  });
});
