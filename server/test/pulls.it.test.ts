/**
 * `GET /pulls/:id` — PR Brief banner aggregate (Phase 2 of
 * docs/intent-smartdiff-improvements.md): score (MIN across the latest
 * review batch), latest_run_cost_usd (SUM), findings (rollupSeverities),
 * verdict (worstVerdict) — computed once and shared by BOTH the live-refresh
 * and offline-fallback branches. No existing integration test exercises this
 * route at all before this file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { z } from 'zod';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockIntentDeriver,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type {
  Review,
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/**
 * Returns a different Review fixture per agent, keyed by a marker string
 * baked into that agent's `system_prompt` — same shape as
 * `reviews.it.test.ts`'s `PerAgentMockLLM` (file-local per `*.it.test.ts`
 * convention, not imported).
 */
class PerAgentMockLLM implements LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'openrouter' = 'openai';
  constructor(private fixtureByMarker: Record<string, Review>) {}

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: 'mock completion', model: req.model, tokensIn: 100, tokensOut: 50, costUsd: 0.001 };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const text = req.messages.map((m) => m.content).join('\n');
    const marker = Object.keys(this.fixtureByMarker).find((m) => text.includes(m));
    if (!marker) throw new Error(`PerAgentMockLLM: no fixture marker found in prompt: ${text.slice(0, 200)}`);
    const fixture = this.fixtureByMarker[marker];
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    if (!parsed.success) throw new Error(`PerAgentMockLLM fixture failed schema: ${parsed.error.message}`);
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(1536).fill(0));
  }
}

let repoSeq = 0;

async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

/** Disable every currently-enabled agent in the shared workspace so a
 *  `{ all: true }` review run only exercises the markers this test creates. */
async function disableExistingAgents(app: Awaited<ReturnType<typeof buildApp>>) {
  const existing = (await app.inject({ method: 'GET', url: '/agents' })).json();
  for (const a of existing) {
    if (a.enabled) {
      await app.inject({ method: 'PUT', url: `/agents/${a.id}`, payload: { enabled: false } });
    }
  }
}

d('GET /pulls/:id — PR Brief banner aggregate (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('live-refresh branch: mixed-verdict multi-agent batch shows worst verdict, MIN score, summed cost + findings', async () => {
    const approveClean: Review = { verdict: 'approve', summary: 'Looks fine.', score: 100, findings: [] };
    const requestChangesOneFinding: Review = {
      verdict: 'request_changes',
      summary: 'Hardcoded Stripe secret introduced.',
      score: 42,
      findings: [
        {
          id: 'f-valid',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          rationale: 'A live Stripe key is committed in source.',
          suggestion: 'Move the key to an environment variable.',
          confidence: 0.95,
          kind: 'finding',
        },
      ],
    };
    const commentOnly: Review = { verdict: 'comment', summary: 'A minor nit.', score: 90, findings: [] };

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        intentDeriver: new MockIntentDeriver(undefined),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: {
          openai: new PerAgentMockLLM({
            AGENT_APPROVE: approveClean,
            AGENT_BLOCKS: requestChangesOneFinding,
            AGENT_COMMENTS: commentOnly,
          }),
        },
      },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await disableExistingAgents(app);

    for (const marker of ['AGENT_APPROVE', 'AGENT_BLOCKS', 'AGENT_COMMENTS']) {
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: marker, provider: 'openai', model: 'gpt-4.1', system_prompt: marker },
      });
    }

    const runBody = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    expect(runBody.runs).toHaveLength(3);
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });

    const detail = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}` })).json();

    // Worst-of verdict across the batch: request_changes beats comment/approve.
    expect(detail.verdict).toBe('request_changes');
    // MIN score across the batch (grounding recomputes AGENT_BLOCKS' score
    // from its one surviving CRITICAL finding: 100 − 35 = 65 — the worst of
    // {100, 65, 90}).
    expect(detail.score).toBe(65);
    // Summed cost across all 3 agents in the batch: 3 × $0.001.
    expect(detail.latest_run_cost_usd).toBeCloseTo(0.003);
    // Summed findings across the batch (only AGENT_BLOCKS found something).
    expect(detail.findings).toEqual({ critical: 1, warning: 0, suggestion: 0 });

    await app.close();
  });

  it('offline-fallback branch (no GitHub token): prBrief is the SAME shared aggregate, not re-duplicated', async () => {
    // Grounding recomputes the score from surviving findings, never trusting
    // the model's self-reported value — zero findings survive ⇒ a clean 100,
    // regardless of the self-reported `score: 88` below (mirrors
    // `reviews.it.test.ts`'s "runs a review" test, which documents the same
    // recompute-from-survivors rule).
    const approveClean: Review = { verdict: 'approve', summary: 'Looks fine.', score: 88, findings: [] };

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        intentDeriver: new MockIntentDeriver(undefined),
        git: new MockGitClient({ diff: DIFF }),
        // No `github` override AND a secrets provider with no GITHUB_TOKEN —
        // forces container.github() to throw ConfigError, driving the route
        // into its catch/offline-fallback branch. Never rely on the dev
        // machine's real ~/.devdigest/secrets.json lacking a token.
        secrets: new MockSecretsProvider({}),
        llm: { openai: new MockLLMProvider('openai', { structured: approveClean }) },
      },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await disableExistingAgents(app);
    await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'Solo', provider: 'openai', model: 'gpt-4.1', system_prompt: 'solo' },
    });
    const existing = (await app.inject({ method: 'GET', url: '/agents' })).json();
    const solo = existing.find((a: { name: string }) => a.name === 'Solo');

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: solo.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const detail = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}` })).json();
    expect(detail.verdict).toBe('approve');
    expect(detail.score).toBe(100);
    expect(detail.latest_run_cost_usd).toBeCloseTo(0.001);
    expect(detail.findings).toEqual({ critical: 0, warning: 0, suggestion: 0 });
    // Confirms the offline path really was taken (persisted body served, not
    // a fresh GitHub fetch) — same PR body seeded by setupRepoAndPr.
    expect(detail.body).toBe('Add rate limiting. Closes #471.');

    await app.close();
  });

  it('zero-reviews PR: all four aggregate fields are null, not a crash', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        intentDeriver: new MockIntentDeriver(undefined),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
      },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });
    expect(res.statusCode).toBe(200);
    const detail = res.json();
    expect(detail.verdict).toBeNull();
    expect(detail.score).toBeNull();
    expect(detail.latest_run_cost_usd).toBeNull();
    expect(detail.findings).toBeNull();

    await app.close();
  });
});
