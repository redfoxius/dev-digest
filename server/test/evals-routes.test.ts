/**
 * `evals` routes — HTTP-layer behavior (no Docker)
 * (`specs/cross-cutting/eval-pipeline/plan.md` Work Item 8, spec §10).
 *
 * `evals-routes-smoke.test.ts` only confirms the route table has all 8 paths
 * — nothing exercises an actual request/response. This file builds a real
 * Fastify app (`buildApp`) against a queue-based fake `Db` (mirrors
 * `test/evals-service.test.ts`'s `makeFakeDb`) and a `MockAuthProvider` (no
 * seeded DB rows needed for `getContext`'s `currentUser`/`currentWorkspace`),
 * then drives requests via `app.inject()` — the same approach every other
 * server-unit route test in this repo lacks for a brand-new module, per the
 * test-writer brief's explicit ask to add it here.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import type { ContainerOverrides } from '../src/platform/container.js';
import { MockAuthProvider, MockLLMProvider } from '../src/adapters/mocks.js';

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const WS = 'ws-1';
const AGENT_ID = '11111111-1111-1111-1111-111111111111';
const CASE_ID = '22222222-2222-2222-2222-222222222222';

// ---- fake Db (mirrors test/evals-service.test.ts's makeFakeDb) ------------

interface FakeCall {
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: unknown;
}

function makeFakeDb(queue: unknown[]): { db: Db; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let i = 0;

  function nextResult(): unknown {
    if (i >= queue.length) {
      throw new Error(`makeFakeDb: no queued result for call #${i} (queue has ${queue.length})`);
    }
    return queue[i++];
  }

  function chain(call: FakeCall) {
    const c = {
      from() {
        return c;
      },
      where() {
        return c;
      },
      orderBy() {
        return c;
      },
      groupBy() {
        return c;
      },
      innerJoin() {
        return c;
      },
      leftJoin() {
        return c;
      },
      values(payload: unknown) {
        call.payload = payload;
        return c;
      },
      set(payload: unknown) {
        call.payload = payload;
        return c;
      },
      returning() {
        return c;
      },
      onConflictDoNothing() {
        return c;
      },
      onConflictDoUpdate() {
        return c;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        try {
          const result = nextResult();
          if (result instanceof Error) throw result;
          resolve(result);
        } catch (err) {
          if (reject) reject(err);
          else throw err;
        }
      },
    };
    return c;
  }

  const db = {
    select: () => {
      const call: FakeCall = { op: 'select' };
      calls.push(call);
      return chain(call);
    },
    insert: () => {
      const call: FakeCall = { op: 'insert' };
      calls.push(call);
      return chain(call);
    },
    update: () => {
      const call: FakeCall = { op: 'update' };
      calls.push(call);
      return chain(call);
    },
    delete: () => {
      const call: FakeCall = { op: 'delete' };
      calls.push(call);
      return chain(call);
    },
    transaction: (fn: (tx: Db) => Promise<unknown>) => fn(db),
  } as unknown as Db;

  return { db, calls };
}

// ---- fixtures --------------------------------------------------------

const agentRow = (overrides: Record<string, unknown> = {}) => ({
  id: AGENT_ID,
  workspaceId: WS,
  name: 'Test Agent',
  description: '',
  provider: 'openai',
  model: 'gpt-4o-mini',
  systemPrompt: 'Review the diff.',
  outputSchema: null,
  strategy: 'single-pass',
  ciFailOn: 'critical',
  repoIntel: true,
  enabled: true,
  version: 1,
  createdBy: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const DIFF_TEXT = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,2 +1,3 @@',
  ' function foo() {',
  '+  doSomethingRisky();',
  ' }',
].join('\n');

const evalCaseRow = (overrides: Record<string, unknown> = {}) => ({
  id: CASE_ID,
  workspaceId: WS,
  ownerKind: 'agent',
  ownerId: AGENT_ID,
  name: 'A case',
  inputDiff: DIFF_TEXT,
  inputFiles: null,
  inputMeta: null,
  expectedOutput: { expectations: [] },
  notes: null,
  ...overrides,
});

function reviewFixture(overrides: Record<string, unknown> = {}) {
  return {
    verdict: 'comment',
    summary: 'ok',
    score: 80,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'bug',
        title: 'Risky call',
        file: 'src/app.ts',
        start_line: 2,
        end_line: 2,
        rationale: 'because',
        suggestion: null,
        confidence: 0.9,
      },
    ],
    ...overrides,
  };
}

/** Every `buildApp()` call reaps stale `agent_runs` on boot (`app.ts:80-85`,
 *  ONE `update().returning()` call) BEFORE any module route runs — always the
 *  first queued item. `[]` keeps it a clean no-op (0 reaped) rather than
 *  relying on `app.ts`'s try/catch to swallow a starved-queue error. */
const REAP = [] as unknown[];

async function buildTestApp(queue: unknown[], llm = new MockLLMProvider('openai')): Promise<{
  app: FastifyInstance;
  calls: FakeCall[];
}> {
  const { db, calls } = makeFakeDb([REAP, ...queue]);
  const overrides: ContainerOverrides = {
    auth: new MockAuthProvider({ id: 'u1', email: 'you@local', name: 'You' }, { id: WS, name: 'default' }),
    llm: { openai: llm },
  };
  const app = await buildApp({ config: config(), db, overrides });
  await app.ready();
  return { app, calls };
}

// ==========================================================================
// Happy path — POST /agents/:id/eval-runs (AC-12/AC-15)
// ==========================================================================

describe('POST /agents/:id/eval-runs', () => {
  it('200s with the degenerate EvalRun for an agent with zero eval cases', async () => {
    const { app } = await buildTestApp([
      [agentRow()], // agentsRepo.getById
      [], // repo.listCases — no cases
    ]);

    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/eval-runs` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      traces_passed: 0,
      traces_total: 0,
      duration_ms: 0,
      cost_usd: null,
      per_trace: [],
    });
  });
});

// ==========================================================================
// Workspace scoping — AC-24/AC-38: every new route 404s on an agent id that
// doesn't resolve in the caller's workspace (unknown id and foreign-workspace
// id both hit this exact branch, since `agentsRepo.getById` filters
// `workspace_id` inline and returns no row for either case).
// ==========================================================================

describe('workspace scoping (AC-24/AC-38)', () => {
  it('GET /agents/:id/eval-cases 404s when the agent id does not resolve in the workspace', async () => {
    const { app } = await buildTestApp([
      [], // agentsRepo.getById — no row (unknown id or foreign workspace)
    ]);

    const res = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/eval-cases` });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it('POST /agents/:id/eval-runs 404s when the agent id does not resolve in the workspace', async () => {
    const { app } = await buildTestApp([
      [], // agentsRepo.getById — no row
    ]);

    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/eval-runs` });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

// ==========================================================================
// Validation — AC-10: malformed expected_output on POST /agents/:id/eval-cases
// ==========================================================================

describe('POST /agents/:id/eval-cases — AC-10 validation', () => {
  it('422s on a malformed expected_output and persists no case', async () => {
    const { app, calls } = await buildTestApp([
      [agentRow()], // agentsRepo.getById
    ]);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/eval-cases`,
      payload: {
        name: 'Bad case',
        expected_output: { expectations: [{ type: 'bogus', file: 'x' }] }, // missing start_line/end_line, invalid type
      },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });
});

// ==========================================================================
// PUT /agents/:id/eval-cases/:caseId — empty-patch short-circuit
// (pr-self-review fix 3): a body with no fields to update must not 500 — it
// returns 200 with the case unchanged, and issues no UPDATE at all.
// ==========================================================================

describe('PUT /agents/:id/eval-cases/:caseId — empty-patch short-circuit (fix 3)', () => {
  it('200s with the unchanged case instead of throwing when the body has no fields to update', async () => {
    const { app, calls } = await buildTestApp([
      [agentRow()], // agentsRepo.getById
      [evalCaseRow()], // repo.getCase — existing-case ownership check
      [evalCaseRow()], // repo.getCase — updateCase's own empty-patch short-circuit
    ]);
    // `buildApp` already reaps stale agent_runs on boot via its own
    // `.update().returning()` call (`REAP`, see this file's header comment) —
    // that call is unrelated to this request, so only calls made AFTER boot
    // count toward "did this PUT issue an UPDATE".
    const callsBeforeRequest = calls.length;

    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${AGENT_ID}/eval-cases/${CASE_ID}`,
      payload: {},
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(CASE_ID);
    expect(calls.slice(callsBeforeRequest).filter((c) => c.op === 'update')).toHaveLength(0);
  });
});

// ==========================================================================
// Single-case run response shape — POST /agents/:id/eval-cases/:caseId/run
// (spec §10 documents `EvalRunResult` — {run_id, case_id, result: EvalRun} —
// AC-11's own wording requires it for the single-case route. This test
// asserts that wrapper is what's actually returned: `run_id` is the specific
// persisted `eval_runs` row's real id (from `insertRunBatch`'s `.returning()`
// result), `case_id` echoes the requested case, and `result` carries the
// aggregate `EvalRun` metrics.)
// ==========================================================================

describe('POST /agents/:id/eval-cases/:caseId/run — response shape (AC-11)', () => {
  it('200s with an EvalRunResult wrapper ({run_id, case_id, result})', async () => {
    const llm = new MockLLMProvider('openai', { structured: reviewFixture() });
    const { app } = await buildTestApp(
      [
        [agentRow()], // agentsRepo.getById
        [evalCaseRow()], // repo.getCase
        [], // agentsRepo.linkedSkills (resolveAgentRunConfig)
        [{ id: 'run-1', caseId: CASE_ID }], // insertRunBatch — one transactional insert
      ],
      llm,
    );

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/eval-cases/${CASE_ID}/run`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The EvalRunResult wrapper — run_id is the persisted row's real id,
    // case_id echoes the requested case.
    expect(body.run_id).toBe('run-1');
    expect(body.case_id).toBe(CASE_ID);
    // `result` carries the aggregate EvalRun: top-level metrics + one
    // per_trace entry for this single-case run.
    expect(body.result).toHaveProperty('recall');
    expect(body.result).toHaveProperty('precision');
    expect(body.result).toHaveProperty('citation_accuracy');
    expect(body.result.per_trace).toHaveLength(1);
    expect(body.result.traces_total).toBe(1);
  });
});
