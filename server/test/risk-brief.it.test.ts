/**
 * `GET`/`POST /pulls/:id/brief` — integration, real Postgres via
 * testcontainers (`specs/cross-cutting/pr-why-risk-brief/plan.md` Work Item
 * 8). Covers AC-1 (seeded row served verbatim, zero LLM calls), AC-2 (empty
 * table → null), AC-3 (unknown/foreign-workspace PR id → 404 on both
 * routes), AC-15 (an 11th POST within 60s → 429, real rate limiter).
 *
 * Two cases below close a gap left by the above: every prior case here
 * either seeds `pr_brief` directly via the repository (never through
 * `RiskBriefService.generate()`) or only asserts HTTP status codes across
 * repeated POSTs (AC-15) without ever inspecting what got generated/
 * persisted. Neither exercises a real cache-MISS POST through the actual
 * Fastify route end-to-end — full fact-gathering (Intent/Blast/diff/issue/
 * relevant-specs) + one real LLM call (mocked at the `Container` boundary
 * only) + grounding/bounding + persist — against real Postgres:
 *   - "the full generation pipeline" — AC-5/AC-10/AC-11 through the real
 *     route: a fabricated `risks[].file_refs` entry the mocked LLM returns
 *     is dropped by the real grounding pass (fed real diff data loaded from
 *     Postgres, not a fixture), and the generated brief is actually written
 *     to `pr_brief` (a follow-up GET returns exactly what POST computed).
 *   - "an LLM failure ... leaves ... untouched" — AC-5 (stale head_sha
 *     triggers an attempt) + AC-14 (failure never overwrites a prior valid
 *     row) through the real route/DB, not just a mocked-Container unit test.
 *
 * A third case below closes a DIFFERENT gap, found while auditing this
 * file for a test-writer follow-up pass: AC-9's `degraded_reason:
 * 'input_too_large'` branch in `RiskBriefService.generate()` (`if
 * (assembled.droppedInputTooLarge) { return { brief: null, degraded_reason:
 * 'input_too_large' }; }`) had ZERO test coverage anywhere in the codebase
 * before this — `risk-brief-prompt.test.ts` only unit-tests the pure
 * `assembleRiskBriefInput()` helper's own `droppedInputTooLarge: true`
 * return value in isolation, and `risk-brief-service.test.ts` never
 * constructs a facts set large enough to trigger it, so the actual
 * WIRING between that pure-function signal and the service's early-return
 * (skip the LLM call entirely, return the degraded shape, never touch a
 * prior persisted row) was unverified at every layer, unit and
 * integration alike:
 *   - "AC-9 end-to-end" — a real diff loaded from Postgres via the genuine
 *     `loadDiff()`/`parseUnifiedDiff()` path, engineered to alone exceed the
 *     8,000-estimated-token budget, drives a real POST through the real
 *     route and confirms zero LLM adapter calls, the `input_too_large`
 *     degraded shape, and a prior valid persisted row left untouched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockIntentDeriver, MockLLMProvider } from '../src/adapters/mocks.js';
import type { ContainerOverrides } from '../src/platform/container.js';
import { RiskBriefRepository } from '../src/modules/risk-brief/repository.js';
import * as t from '../src/db/schema.js';
import type { RiskBrief } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[risk-brief] Docker not available — skipping integration tests.');
}

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A minimal, schema-valid `RiskBrief` fixture for seeding `pr_brief` rows. */
function makeRiskBriefFixture(overrides: Partial<RiskBrief> = {}): RiskBrief {
  return {
    what: 'Adds rate limiting middleware.',
    why: 'Prevents abusive request bursts.',
    risk_level: 'medium',
    risks: [],
    review_focus: [],
    pr_head_sha: 'a1b2c3d4',
    provider: 'openai',
    model: 'gpt-4.1',
    generated_at: '2026-08-20T00:00:00Z',
    ...overrides,
  };
}

/** The classifier's own structured-output fixture shape (`RiskBriefDerivation`
 *  in `risk-brief/service.ts`) — what the mocked LLM adapter returns. */
function makeDerivationFixture() {
  return {
    what: 'Adds rate limiting middleware.',
    why: 'Prevents abusive request bursts.',
    risk_level: 'medium' as const,
    risks: [],
    review_focus: [],
  };
}

/**
 * A unified-diff string with `fileCount` files, each under a deliberately
 * long directory path — mirrors `risk-brief-prompt.test.ts`'s own AC-9
 * fixture template (`packages/some-very-long-directory-name/src/components/
 * file-N.tsx`), but rendered as REAL `git diff` text so it flows through the
 * genuine `MockGitClient` → `loadDiff()` → `parseUnifiedDiff()` path instead
 * of being handed directly to `assembleRiskBriefInput()`. The "Changed
 * files" section (AC-9's "minimum-required input", never trimmed) alone is
 * ~3000 * ~70 chars ≈ 210,000 chars ≈ 52,500 estimated tokens — far above
 * the 8,000 budget even after every optional section (relevant specs,
 * issue body, hunk headers) is dropped.
 */
function buildHugeDiff(fileCount: number): string {
  const parts: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    const p = `packages/some-very-long-directory-name/src/components/file-${i}.tsx`;
    parts.push(`diff --git a/${p} b/${p}`);
    parts.push(`--- a/${p}`);
    parts.push(`+++ b/${p}`);
    parts.push('@@ -1,1 +1,2 @@');
    parts.push(' unchanged line');
    parts.push('+added line');
  }
  return parts.join('\n');
}

d('risk-brief module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-workspace' })
      .returning();
    otherWorkspaceId = otherWs!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** `nodeEnv: 'development'` (not 'test') so the global `@fastify/rate-limit`
   *  plugin actually registers (`app.ts:95-97` skips it entirely under
   *  'test', which every OTHER test in this file relies on to hammer routes
   *  freely via `inject()`) — needed only by the AC-15 test below. */
  function makeApp(opts: { llm?: MockLLMProvider; nodeEnv?: 'test' | 'development'; diff?: string } = {}) {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: opts.nodeEnv ?? 'test',
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);
    const overrides: ContainerOverrides = {
      embedder: new MockEmbedder(),
      intentDeriver: new MockIntentDeriver(undefined),
      git: new MockGitClient({ diff: opts.diff ?? DIFF }),
      github: new MockGitHubClient(),
    };
    if (opts.llm) overrides.llm = { openrouter: opts.llm };
    return buildApp({ config, db: pg.handle.db, overrides });
  }

  async function setupRepoAndPr(ws: string = workspaceId, headSha = 'a1b2c3d4') {
    const name = `payments-api-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha,
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'Add rate limiting.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { repo: repo!, pr: pr! };
  }

  it('AC-1 — GET with a persisted brief returns it verbatim, zero LLM calls', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: makeDerivationFixture() });
    const app = await makeApp({ llm });
    const { pr } = await setupRepoAndPr();
    const fixture = makeRiskBriefFixture({ pr_head_sha: pr.headSha });
    await new RiskBriefRepository(pg.handle.db).upsert(pr.id, fixture);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(fixture);
    expect(llm.calls).toHaveLength(0);

    await app.close();
  });

  it('AC-2 — GET with no persisted brief returns null', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr();

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();

    await app.close();
  });

  it('AC-3 — an unknown PR id 404s on both GET and POST', async () => {
    const app = await makeApp();
    const unknownId = randomUUID();

    const getRes = await app.inject({ method: 'GET', url: `/pulls/${unknownId}/brief` });
    expect(getRes.statusCode).toBe(404);

    const postRes = await app.inject({ method: 'POST', url: `/pulls/${unknownId}/brief` });
    expect(postRes.statusCode).toBe(404);

    await app.close();
  });

  it('AC-3/AC-26 — a foreign-workspace PR id 404s on both GET and POST (never leaks another workspace\'s cached brief)', async () => {
    const app = await makeApp();
    const { pr: foreignPr } = await setupRepoAndPr(otherWorkspaceId);
    await new RiskBriefRepository(pg.handle.db).upsert(
      foreignPr.id,
      makeRiskBriefFixture({ pr_head_sha: foreignPr.headSha }),
    );

    const getRes = await app.inject({ method: 'GET', url: `/pulls/${foreignPr.id}/brief` });
    expect(getRes.statusCode).toBe(404);

    const postRes = await app.inject({ method: 'POST', url: `/pulls/${foreignPr.id}/brief` });
    expect(postRes.statusCode).toBe(404);

    // Sanity: the SAME app, querying a PR under the caller's own (default)
    // workspace, is NOT 404.
    const { pr: ownPr } = await setupRepoAndPr(workspaceId);
    const okRes = await app.inject({ method: 'GET', url: `/pulls/${ownPr.id}/brief` });
    expect(okRes.statusCode).toBe(200);

    await app.close();
  });

  it('AC-15 — an 11th POST within 60s from the same source returns 429 (real rate limiter)', async () => {
    const llm = new MockLLMProvider('openrouter', { structured: makeDerivationFixture() });
    const app = await makeApp({ llm, nodeEnv: 'development' });
    const { pr } = await setupRepoAndPr();

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);

    await app.close();
  });

  it('AC-16 — GET is NOT subject to the POST route\'s 10/min rate limit: 11 GETs within the window all succeed', async () => {
    const app = await makeApp({ nodeEnv: 'development' });
    const { pr } = await setupRepoAndPr();

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
      statuses.push(res.statusCode);
    }

    expect(statuses.every((s) => s === 200)).toBe(true);

    await app.close();
  });

  it(
    'AC-5/AC-10/AC-11 — POST with no persisted brief runs the full generation ' +
      'pipeline through the real route (real Postgres fact-gathering + real ' +
      'grounding), and persists exactly what a follow-up GET then returns',
    async () => {
      const derivation = {
        what: 'Adds a rate-limiting middleware and a hardcoded Stripe key to config.',
        why: 'Protects public endpoints from abusive bursts, but leaks a live secret.',
        risk_level: 'high' as const,
        risks: [
          {
            kind: 'security',
            title: 'Hardcoded secret committed to config',
            explanation: 'A live Stripe key is committed in plaintext.',
            severity: 'high' as const,
            // One real diff path (grounded, kept) + one fabricated path that
            // is present in neither the diff, blast changed_symbols, nor any
            // blast downstream endpoint/cron/caller — must be dropped
            // (AC-10) rather than trusted verbatim.
            file_refs: ['src/config.ts', 'src/nonexistent/fabricated.ts'],
          },
        ],
        // Line 11 is within the real hunk's new-line range (@@ -10,3 +10,4 @@
        // → new lines 10-13) loaded from Postgres-persisted pr_files, not a
        // fixture value asserted in isolation.
        review_focus: [{ file: 'src/config.ts', line: 11, reason: 'Hardcoded Stripe key committed here.' }],
      };
      const llm = new MockLLMProvider('openrouter', { structured: derivation });
      const app = await makeApp({ llm });
      const { pr } = await setupRepoAndPr();

      const postRes = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      expect(postRes.statusCode).toBe(200);
      const body = postRes.json();
      expect(body.degraded_reason).toBeUndefined();
      expect(body.cached).toBe(false);
      expect(body.brief).not.toBeNull();
      expect(body.brief.risk_level).toBe('high');
      expect(body.brief.pr_head_sha).toBe(pr.headSha);
      // AC-10: the fabricated file_ref was dropped by the real grounding
      // pass; the real diff-file ref survived.
      expect(body.brief.risks).toHaveLength(1);
      expect(body.brief.risks[0].file_refs).toEqual(['src/config.ts']);
      // AC-11: the in-range review_focus entry survived unchanged.
      expect(body.brief.review_focus).toEqual([
        { file: 'src/config.ts', line: 11, reason: 'Hardcoded Stripe key committed here.' },
      ]);
      expect(llm.calls).toHaveLength(1);

      // Persisted for real: a follow-up GET (zero further LLM calls) returns
      // exactly what generate() computed and wrote to `pr_brief`.
      const getRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json()).toEqual(body.brief);
      expect(llm.calls).toHaveLength(1);

      await app.close();
    },
  );

  it(
    'AC-5/AC-14 — an LLM failure through the real route (stale head_sha triggers ' +
      "a real regeneration attempt) leaves a prior valid persisted brief in " +
      "Postgres untouched, and returns degraded_reason: 'llm_failed'",
    async () => {
      // MockLLMProvider with no `structured` fixture supplied defaults to
      // `{}`, which fails RiskBriefDerivation's schema — completeStructured
      // throws, exactly like a real schema-invalid/failed LLM response.
      const llm = new MockLLMProvider('openrouter', {});
      const app = await makeApp({ llm });
      const { pr } = await setupRepoAndPr();

      const priorBrief = makeRiskBriefFixture({ pr_head_sha: 'stale-sha-before-this-pr' });
      await new RiskBriefRepository(pg.handle.db).upsert(pr.id, priorBrief);

      const postRes = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      expect(postRes.statusCode).toBe(200);
      const body = postRes.json();
      expect(body.brief).toBeNull();
      expect(body.degraded_reason).toBe('llm_failed');
      expect(llm.calls).toHaveLength(1);

      // The prior valid row was left completely untouched in Postgres — a
      // follow-up GET still returns it verbatim.
      const getRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json()).toEqual(priorBrief);

      await app.close();
    },
  );

  it(
    "AC-9 — a real diff big enough to alone exceed the 8,000-token budget, loaded " +
      "through the genuine loadDiff()/parseUnifiedDiff() path, makes the real route " +
      "return degraded_reason: 'input_too_large' with zero LLM calls, and leaves a " +
      'prior valid persisted brief in Postgres untouched',
    async () => {
      const llm = new MockLLMProvider('openrouter', { structured: makeDerivationFixture() });
      const app = await makeApp({ llm, diff: buildHugeDiff(3000) });
      const { pr } = await setupRepoAndPr();

      const priorBrief = makeRiskBriefFixture({ pr_head_sha: 'stale-sha-before-this-pr' });
      await new RiskBriefRepository(pg.handle.db).upsert(pr.id, priorBrief);

      const postRes = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      expect(postRes.statusCode).toBe(200);
      const body = postRes.json();
      expect(body.brief).toBeNull();
      expect(body.degraded_reason).toBe('input_too_large');
      // The LLM was never called — the budget check short-circuits before it.
      expect(llm.calls).toHaveLength(0);

      // The prior valid row was left completely untouched in Postgres — a
      // follow-up GET still returns it verbatim.
      const getRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json()).toEqual(priorBrief);

      await app.close();
    },
  );
});
