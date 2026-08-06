import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { z } from 'zod';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
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

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
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
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

/**
 * Returns a different Review fixture per agent, keyed by a marker string
 * baked into that agent's `system_prompt` — lets a "run all" test simulate
 * agents disagreeing (some find nothing, one finds something) regardless of
 * which order they happen to run/finish in (single-pass runs sequentially,
 * but nothing in this test should depend on that).
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

/**
 * Like PerAgentMockLLM, but a marker in `blockMarkers` makes that agent's
 * call hang until the test explicitly `release()`s it — lets a test observe
 * DB state while one agent in a batch has genuinely finished and another is
 * still mid-flight, instead of racing real async completion order.
 */
class ControllableMockLLM implements LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'openrouter' = 'openai';
  private gates = new Map<string, { promise: Promise<void>; release: () => void }>();

  constructor(
    private fixtureByMarker: Record<string, Review>,
    private blockMarkers: Set<string>,
  ) {}

  release(marker: string): void {
    this.gates.get(marker)?.release();
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: 'mock completion', model: req.model, tokensIn: 100, tokensOut: 50, costUsd: 0.001 };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const text = req.messages.map((m) => m.content).join('\n');
    const marker = Object.keys(this.fixtureByMarker).find((m) => text.includes(m));
    if (!marker) throw new Error(`ControllableMockLLM: no fixture marker found in prompt: ${text.slice(0, 200)}`);

    if (this.blockMarkers.has(marker)) {
      if (!this.gates.has(marker)) {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => (release = resolve));
        this.gates.set(marker, { promise, release });
      }
      await this.gates.get(marker)!.promise;
    }

    const fixture = this.fixtureByMarker[marker];
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    if (!parsed.success) throw new Error(`ControllableMockLLM fixture failed schema: ${parsed.error.message}`);
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
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
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

  function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.log.length).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');

    // Cost: MockLLMProvider returns costUsd: 0.001 per LLM call, and
    // reviewer-core sums it across every chunk — so the persisted cost is
    // exactly 0.001 × the number of chunks this run actually made (derived
    // from the trace's own tool_calls, one per chunk, rather than hardcoding
    // a chunk count here).
    const expectedCost = trace.tool_calls.length * 0.001;
    expect(review.cost_usd).toBeCloseTo(expectedCost);
    expect(run!.costUsd).toBeCloseTo(expectedCost);
    expect(trace.stats.cost_usd).toBeCloseTo(expectedCost);

    // PR-list COST column sums cost across every agent run for the PR, and
    // also surfaces the single most recent run's cost separately — with only
    // one run so far, the two are identical.
    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const listedPr = pulls.find((p: { id: string }) => p.id === pr.id);
    expect(listedPr.cost_usd).toBeCloseTo(expectedCost);
    expect(listedPr.latest_run_cost_usd).toBeCloseTo(expectedCost);

    // FINDINGS column: the ids of this PR's latest review batch (just the
    // one review here), plus its live per-severity breakdown (grounding
    // kept exactly one CRITICAL finding).
    expect(listedPr.latest_review_ids).toEqual([review.id]);
    expect(listedPr.findings).toEqual({ critical: 1, warning: 0, suggestion: 0 });

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    // Before dismissing, the PR-list FINDINGS column counts the one CRITICAL finding.
    const before = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(before.find((p: { id: string }) => p.id === pr.id).findings).toEqual({
      critical: 1,
      warning: 0,
      suggestion: 0,
    });

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    // FINDINGS counts are LIVE, not a snapshot: dismissing drops the count on
    // the very next list fetch, with no other state change.
    const after = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(after.find((p: { id: string }) => p.id === pr.id).findings).toEqual({
      critical: 0,
      warning: 0,
      suggestion: 0,
    });

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  it('PR-list FINDINGS/COST sum every agent from the LAST "run all" action, not just whichever one finished last', async () => {
    const noFindings: Review = { verdict: 'approve', summary: 'Looks fine.', score: 100, findings: [] };
    const oneFinding: Review = {
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

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          openai: new PerAgentMockLLM({
            AGENT_NOTHING_1: noFindings,
            AGENT_HAS_ISSUE: oneFinding,
            AGENT_NOTHING_2: noFindings,
          }),
        },
      },
    });
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Isolate this test from every other enabled agent in the shared
    // workspace (seed agents + agents created by earlier tests in this
    // file) — `all:true` runs every enabled agent, and this test needs to
    // control the exact set.
    const existing = (await app.inject({ method: 'GET', url: '/agents' })).json();
    for (const a of existing) {
      if (a.enabled) {
        await app.inject({ method: 'PUT', url: `/agents/${a.id}`, payload: { enabled: false } });
      }
    }

    for (const marker of ['AGENT_NOTHING_1', 'AGENT_HAS_ISSUE', 'AGENT_NOTHING_2']) {
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: marker, provider: 'openai', model: 'gpt-4.1', system_prompt: marker },
      });
    }

    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    expect(body.runs).toHaveLength(3);
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });

    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(3);

    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const listedPr = pulls.find((p: { id: string }) => p.id === pr.id);

    // The bug: picking a single "latest review" row by createdAt would show
    // whichever no-findings agent happened to be inserted last — hiding the
    // one agent that actually found something. Batch-grouping by
    // multi_agent_run_id must sum across all 3.
    expect(listedPr.findings).toEqual({ critical: 1, warning: 0, suggestion: 0 });
    expect(listedPr.latest_review_ids).toHaveLength(3);
    expect(new Set(listedPr.latest_review_ids)).toEqual(new Set(reviews.map((r: { id: string }) => r.id)));

    // Same bug, same fix, for cost: 3 agents × $0.001/call = $0.003 for the
    // batch, not just one agent's $0.001.
    expect(listedPr.latest_run_cost_usd).toBeCloseTo(0.003);
    expect(listedPr.cost_usd).toBeCloseTo(0.003);

    // Same bug, same fix, for score: AGENT_NOTHING_2 finishes last with a
    // clean 100, but AGENT_HAS_ISSUE (same batch) grounds one CRITICAL
    // finding — recomputed score 100 − 35 = 65 (grounding recomputes score
    // from survivors, never trusts the model's self-reported 42; see the
    // map-reduce test above). The list must show the batch's WORST score
    // (65), not whichever agent happened to be inserted last, or a real
    // rejection reads as a clean pass.
    expect(listedPr.score).toBe(65);

    await app.close();
  });

  it('PR status does not flip to "reviewed" until every agent in the batch has settled', async () => {
    const fastFixture: Review = { verdict: 'approve', summary: 'Fast agent done.', score: 100, findings: [] };
    const slowFixture: Review = { verdict: 'approve', summary: 'Slow agent done.', score: 100, findings: [] };
    const llm = new ControllableMockLLM(
      { AGENT_FAST: fastFixture, AGENT_SLOW: slowFixture },
      new Set(['AGENT_SLOW']),
    );

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
      },
    });
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const existing = (await app.inject({ method: 'GET', url: '/agents' })).json();
    for (const a of existing) {
      if (a.enabled) {
        await app.inject({ method: 'PUT', url: `/agents/${a.id}`, payload: { enabled: false } });
      }
    }
    for (const marker of ['AGENT_FAST', 'AGENT_SLOW']) {
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: marker, provider: 'openai', model: 'gpt-4.1', system_prompt: marker },
      });
    }

    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    expect(body.runs).toHaveLength(2);

    // Poll until AGENT_FAST's own agent_runs row is 'done' — AGENT_SLOW is
    // still blocked on its ControllableMockLLM gate, so the batch as a whole
    // has NOT settled yet.
    const deadline = Date.now() + 10_000;
    for (;;) {
      const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
      if (runs.some((r) => r.status === 'done')) break;
      if (Date.now() > deadline) throw new Error('timed out waiting for AGENT_FAST to finish');
      await new Promise((r) => setTimeout(r, 25));
    }

    const midBatch = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const midBatchPr = midBatch.find((p: { id: string }) => p.id === pr.id);
    // The bug: markReviewed() used to fire per-agent, so the PR flipped to
    // "reviewed" the instant AGENT_FAST finished — while AGENT_SLOW (part of
    // the SAME requested batch) is still running. That reads as "the review
    // is done" when it plainly isn't.
    expect(midBatchPr.status).not.toBe('reviewed');

    llm.release('AGENT_SLOW');
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const afterBatch = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const afterBatchPr = afterBatch.find((p: { id: string }) => p.id === pr.id);
    expect(afterBatchPr.status).toBe('reviewed');

    await app.close();
  });
});
