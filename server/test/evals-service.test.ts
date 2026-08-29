/**
 * `EvalsService` — unit, no Docker
 * (`specs/cross-cutting/eval-pipeline/plan.md` Work Items 4-7, spec §5/§6).
 * A queue-based fake `Db` (mirrors `test/skills.test.ts`'s `makeFakeDb` —
 * every `select/insert/update/delete...returning` call consumes the NEXT
 * queued result, in call order) drives `container.agentsRepo`/
 * `container.reviewRepo`/this module's own `EvalsRepository`; `MockLLMProvider`
 * stands in for the LLM provider and `ContainerOverrides.diffLoader` stands
 * in for `container.diffLoader.load`. No real Postgres, LLM, or network
 * anywhere in this file.
 */
import { describe, it, expect } from 'vitest';
import type { Db } from '../src/db/client.js';
import { Container, type ContainerOverrides } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { NotFoundError, ValidationError } from '../src/platform/errors.js';
import { EvalsService } from '../src/modules/evals/service.js';

const config = () => loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const WS = 'ws-1';
const AGENT_ID = 'agent-1';

// ---- fake Db (mirrors test/skills.test.ts's makeFakeDb) -------------------

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

// ---- fixtures ---------------------------------------------------------

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

const findingRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'finding-1',
  reviewId: 'review-1',
  file: 'src/app.ts',
  startLine: 2,
  endLine: 2,
  severity: 'CRITICAL',
  category: 'bug',
  title: 'Risky call',
  rationale: 'because',
  suggestion: null,
  confidence: 0.9,
  kind: 'finding',
  trifectaComponents: null,
  acceptedAt: null,
  dismissedAt: null,
  inScope: null,
  ...overrides,
});

const reviewRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'review-1',
  workspaceId: WS,
  prId: 'pr-1',
  agentId: AGENT_ID,
  runId: 'run-1',
  kind: 'review',
  verdict: 'comment',
  summary: null,
  score: null,
  model: null,
  costUsd: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const pullRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'pr-1',
  workspaceId: WS,
  repoId: 'repo-1',
  number: 42,
  title: 'Fix things',
  author: 'octo',
  branch: 'feat/x',
  base: 'main',
  headSha: 'sha1',
  lastReviewedSha: null,
  additions: 1,
  deletions: 0,
  filesCount: 1,
  status: 'needs_review',
  body: null,
  openedAt: null,
  updatedAt: null,
  ...overrides,
});

const repoRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'repo-1',
  workspaceId: WS,
  owner: 'acme',
  name: 'widgets',
  fullName: 'acme/widgets',
  defaultBranch: 'main',
  clonePath: '/clones/acme-widgets',
  contextSearchExcludes: null,
  lastPolledAt: null,
  createdBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const evalCaseRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'case-1',
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

const DIFF_TEXT = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,2 +1,3 @@',
  ' function foo() {',
  '+  doSomethingRisky();',
  ' }',
].join('\n');

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

function containerWith(db: Db, llm: MockLLMProvider, diff?: unknown): Container {
  const overrides: ContainerOverrides = { llm: { openai: llm } };
  if (diff !== undefined) {
    overrides.diffLoader = { load: async () => diff as never };
  }
  return new Container(config(), db, overrides);
}

// ==========================================================================
// WI-4 — createFromFinding (AC-1..AC-5, AC-24)
// ==========================================================================

describe('EvalsService.createFromFinding', () => {
  it('AC-1 — an accepted finding creates one must_find case', async () => {
    const { db, calls } = makeFakeDb([
      [findingRow({ acceptedAt: new Date('2026-01-02T00:00:00Z') })], // getFinding
      [reviewRow()], // getReview
      [pullRow()], // pull select (inline in findingContext)
      [repoRow()], // getRepo
      [{ path: 'src/app.ts', additions: 1, deletions: 0, patch: 'p' }], // getPrFiles
      [{ ...evalCaseRow(), id: 'new-case' }], // insertCase .returning()
    ]);
    const llm = new MockLLMProvider('openai');
    const container = containerWith(db, llm, { raw: DIFF_TEXT, files: [] });
    const service = new EvalsService(container);

    const result = await service.createFromFinding(WS, 'finding-1');

    expect(result.id).toBe('new-case');
    const insertCall = calls.find((c) => c.op === 'insert')!;
    const payload = insertCall.payload as { expectedOutput: { expectations: { type: string }[] } };
    expect(payload.expectedOutput.expectations[0]?.type).toBe('must_find');
  });

  it('AC-2 — a dismissed finding creates one must_not_flag case', async () => {
    const { db, calls } = makeFakeDb([
      [findingRow({ dismissedAt: new Date('2026-01-02T00:00:00Z') })],
      [reviewRow()],
      [pullRow()],
      [repoRow()],
      [[]],
      [{ ...evalCaseRow(), id: 'new-case' }],
    ]);
    const llm = new MockLLMProvider('openai');
    const container = containerWith(db, llm, { raw: DIFF_TEXT, files: [] });
    const service = new EvalsService(container);

    await service.createFromFinding(WS, 'finding-1');

    const insertCall = calls.find((c) => c.op === 'insert')!;
    const payload = insertCall.payload as { expectedOutput: { expectations: { type: string }[] } };
    expect(payload.expectedOutput.expectations[0]?.type).toBe('must_not_flag');
  });

  it('AC-3 — a finding with neither accepted_at nor dismissed_at is rejected with 422, no case created', async () => {
    const { db, calls } = makeFakeDb([[findingRow()], [reviewRow()], [pullRow()]]);
    const container = containerWith(db, new MockLLMProvider('openai'));
    const service = new EvalsService(container);

    await expect(service.createFromFinding(WS, 'finding-1')).rejects.toBeInstanceOf(ValidationError);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('AC-4 — an unknown finding id 404s', async () => {
    const { db } = makeFakeDb([[]]);
    const container = containerWith(db, new MockLLMProvider('openai'));
    const service = new EvalsService(container);

    await expect(service.createFromFinding(WS, 'unknown')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('AC-4 — a cross-workspace finding (foreign PR workspace) 404s', async () => {
    const { db } = makeFakeDb([
      [findingRow({ acceptedAt: new Date() })],
      [reviewRow()],
      [pullRow({ workspaceId: 'other-ws' })],
    ]);
    const container = containerWith(db, new MockLLMProvider('openai'));
    const service = new EvalsService(container);

    await expect(service.createFromFinding(WS, 'finding-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a review with no owning agent (null agent_id) 404s rather than writing owner_id: null', async () => {
    const { db, calls } = makeFakeDb([
      [findingRow({ acceptedAt: new Date() })],
      [reviewRow({ agentId: null })],
      [pullRow()],
    ]);
    const container = containerWith(db, new MockLLMProvider('openai'));
    const service = new EvalsService(container);

    await expect(service.createFromFinding(WS, 'finding-1')).rejects.toBeInstanceOf(NotFoundError);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('AC-5 — a diff-load failure propagates unhandled, creating no case', async () => {
    const { db, calls } = makeFakeDb([
      [findingRow({ acceptedAt: new Date() })],
      [reviewRow()],
      [pullRow()],
      [repoRow()],
    ]);
    const container = new Container(config(), db, {
      llm: { openai: new MockLLMProvider('openai') },
      diffLoader: {
        load: async () => {
          throw new Error('diff unavailable (mock)');
        },
      },
    });
    const service = new EvalsService(container);

    await expect(service.createFromFinding(WS, 'finding-1')).rejects.toThrow('diff unavailable (mock)');
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });
});

// ==========================================================================
// WI-5 — manual case CRUD (AC-6, AC-10, AC-24)
// ==========================================================================

describe('EvalsService manual case CRUD', () => {
  it('AC-6 — owner_kind/owner_id are always derived from the route param, never a client-supplied value', async () => {
    const { db, calls } = makeFakeDb([[agentRow()], [{ ...evalCaseRow(), id: 'new-case' }]]);
    const container = containerWith(db, new MockLLMProvider('openai'));
    const service = new EvalsService(container);

    // Cast simulates a client body smuggling a foreign owner_id — the
    // service's `CreateEvalCaseInput` type has no such field to read.
    await service.createCase(WS, AGENT_ID, {
      name: 'Manual case',
      expected_output: { expectations: [] },
      ...({ owner_id: 'someone-elses-agent', owner_kind: 'skill' } as object),
    });

    const insertCall = calls.find((c) => c.op === 'insert')!;
    const payload = insertCall.payload as { ownerId: string; ownerKind: string };
    expect(payload.ownerId).toBe(AGENT_ID);
    expect(payload.ownerKind).toBe('agent');
  });

  it('AC-24 — an unknown agent id 404s (returns undefined) before touching eval_cases', async () => {
    const { db, calls } = makeFakeDb([[]]);
    const container = containerWith(db, new MockLLMProvider('openai'));
    const service = new EvalsService(container);

    const result = await service.createCase(WS, 'unknown-agent', { name: 'x' });

    expect(result).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('AC-10 — a malformed expected_output is rejected with 422, persisting nothing', async () => {
    const { db, calls } = makeFakeDb([[agentRow()]]);
    const container = containerWith(db, new MockLLMProvider('openai'));
    const service = new EvalsService(container);

    await expect(
      service.createCase(WS, AGENT_ID, {
        name: 'Bad case',
        expected_output: { expectations: [{ type: 'bogus', file: 'x' }] },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('AC-10 — the same malformed expected_output is rejected on update, persisting nothing', async () => {
    const { db, calls } = makeFakeDb([[agentRow()], [evalCaseRow()]]);
    const container = containerWith(db, new MockLLMProvider('openai'));
    const service = new EvalsService(container);

    await expect(
      service.updateCase(WS, AGENT_ID, 'case-1', {
        expected_output: { expectations: [{ type: 'bogus', file: 'x' }] },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(0);
  });

  it('a well-formed expected_output is accepted on create', async () => {
    const { db, calls } = makeFakeDb([[agentRow()], [{ ...evalCaseRow(), id: 'new-case' }]]);
    const container = containerWith(db, new MockLLMProvider('openai'));
    const service = new EvalsService(container);

    const result = await service.createCase(WS, AGENT_ID, {
      name: 'Good case',
      expected_output: { expectations: [{ type: 'must_find', file: 'a.ts', start_line: 1, end_line: 2 }] },
    });

    expect(result?.id).toBe('new-case');
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });
});

// ==========================================================================
// WI-6 — run execution (AC-14, AC-15, AC-37) + prompt-injection self-check
// ==========================================================================

describe('EvalsService.runAll — batch isolation + zero-case degenerate result', () => {
  it('AC-15 — an agent with zero eval cases returns the degenerate EvalRun, inserting nothing', async () => {
    const { db, calls } = makeFakeDb([[agentRow()], []]);
    const container = containerWith(db, new MockLLMProvider('openai'));
    const service = new EvalsService(container);

    const result = await service.runAll(WS, AGENT_ID);

    expect(result).toEqual({
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      traces_passed: 0,
      traces_total: 0,
      duration_ms: 0,
      cost_usd: null,
      per_trace: [],
    });
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('AC-14 — one case failing mid-batch is isolated; the batch still completes with 2 traces total, 1 passed', async () => {
    const llm = new MockLLMProvider('openai', { structured: reviewFixture() });
    llm.completeStructured = (async (req: unknown) => {
      // Fail exactly once (the SECOND case) — first + third succeed.
      const calls = (llm as unknown as { _n?: number })._n ?? 0;
      (llm as unknown as { _n?: number })._n = calls + 1;
      if (calls === 1) throw new Error('provider exploded (mock)');
      return {
        data: reviewFixture(),
        model: (req as { model: string }).model,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.01,
        raw: '{}',
        attempts: 1,
      };
    }) as never;

    const cases = [
      evalCaseRow({
        id: 'case-1',
        expectedOutput: { expectations: [{ type: 'must_find', file: 'src/app.ts', start_line: 2, end_line: 2 }] },
      }),
      evalCaseRow({ id: 'case-2', expectedOutput: { expectations: [] } }),
      evalCaseRow({ id: 'case-3', expectedOutput: { expectations: [] } }),
    ];
    const { db, calls } = makeFakeDb([
      [agentRow()], // getById
      cases, // listCases
      [], // linkedSkills — case-1 (resolveAgentRunConfig runs BEFORE the LLM call, so
      [], // linkedSkills — case-2   this happens even for the case whose later
      [], // linkedSkills — case-3   completeStructured call throws)
      [[{ id: 'run-1' }, { id: 'run-2' }, { id: 'run-3' }]], // insertRunBatch
    ]);
    const container = containerWith(db, llm);
    const service = new EvalsService(container);

    const result = await service.runAll(WS, AGENT_ID);

    expect(result?.traces_total).toBe(3);
    expect(result?.traces_passed).toBe(2);
    expect(result?.per_trace).toHaveLength(3);
    expect(result?.per_trace[1]?.pass).toBe(false);
    expect((result?.per_trace[1]?.actual as { error: string }).error).toBe('provider exploded (mock)');
    // Exactly one transactional batch insert, never one insert per case.
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });

  it('AC-13 — two consecutive runAll calls each trigger their own fresh reviewPullRequest/LLM call per case, never replaying the first', async () => {
    // Spec AC-13's own Verify line: "two consecutive POST /agents/:id/eval-runs
    // calls ... each trigger their own fresh reviewPullRequest/LLM adapter
    // call per case (mocked adapter call count = 2x case count, not case
    // count)". Simulates the "run, edit prompt, run again" flow at the
    // service layer — the case set/count stays fixed; what this actually
    // guards against is a caching/memoization bug that would silently reuse
    // the first call's result instead of hitting the LLM again.
    const llm = new MockLLMProvider('openai', { structured: reviewFixture() });
    const c = evalCaseRow({ expectedOutput: { expectations: [] } });
    const { db } = makeFakeDb([
      [agentRow()], [c], [], [[{ id: 'run-1' }]], // first runAll (1 case)
      [agentRow()], [c], [], [[{ id: 'run-2' }]], // second runAll, after a (simulated) prompt edit
    ]);
    const container = containerWith(db, llm);
    const service = new EvalsService(container);

    await service.runAll(WS, AGENT_ID);
    await service.runAll(WS, AGENT_ID);

    const structuredCalls = llm.calls.filter((call) => call.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(2); // 2x case count (1 case) — never cached/replayed
  });

  it('never threads expected_output into the LLM call — only reviewPullRequest inputs (systemPrompt/model/diff/task) are passed to completeStructured', async () => {
    const secretExpectation = { expectations: [{ type: 'must_find', file: 'src/app.ts', start_line: 2, end_line: 2, description: 'UNIQUE_MARKER_XYZ' }] };
    const llm = new MockLLMProvider('openai', { structured: reviewFixture() });
    const c = evalCaseRow({ expectedOutput: secretExpectation });
    const { db } = makeFakeDb([[agentRow()], [c], [], [[{ id: 'run-1' }]]]);
    const container = containerWith(db, llm);
    const service = new EvalsService(container);

    await service.runAll(WS, AGENT_ID);

    const structuredCall = llm.calls.find((call) => call.method === 'completeStructured')!;
    const req = structuredCall.req as { messages: { content: string }[] };
    const serialized = JSON.stringify(req.messages);
    expect(serialized).not.toContain('UNIQUE_MARKER_XYZ');
  });
});

// ==========================================================================
// WI-7 — getDashboard (AC-23, AC-25)
// ==========================================================================

describe('EvalsService.getDashboard', () => {
  it('AC-25 — a >=2pt metric swing between the two most recent batches produces a non-null alert', async () => {
    const olderRuns = [
      {
        id: 'run-a1',
        caseId: 'case-1',
        ranAt: new Date('2026-01-01T00:00:00Z'),
        actualOutput: { findings: [], must_find_matched: 1, must_find_total: 1, noise_count: 0, kept: 1, dropped: 0 },
        pass: true,
        recall: 1,
        precision: 1,
        citationAccuracy: 1,
        durationMs: 100,
        costUsd: 0.01,
      },
    ];
    const newerRuns = [
      {
        id: 'run-b1',
        caseId: 'case-1',
        ranAt: new Date('2026-01-02T00:00:00Z'),
        actualOutput: { findings: [], must_find_matched: 0, must_find_total: 1, noise_count: 0, kept: 1, dropped: 0 },
        pass: false,
        recall: 0,
        precision: 1,
        citationAccuracy: 1,
        durationMs: 100,
        costUsd: 0.01,
      },
    ];
    const { db } = makeFakeDb([[agentRow()], [evalCaseRow()], [...olderRuns, ...newerRuns]]);
    const container = containerWith(db, new MockLLMProvider('openai'));
    const service = new EvalsService(container);

    const dashboard = await service.getDashboard(WS, AGENT_ID);

    expect(dashboard?.alert).not.toBeNull();
    expect(dashboard?.alert).toContain('Recall');
    expect(dashboard?.trend).toHaveLength(2);
    expect(dashboard?.current.recall).toBe(0);
    expect(dashboard?.delta.recall).toBe(-1);
  });

  it('AC-23 — a zero-batch (no runs yet) dashboard mirrors the AC-15 degenerate shape', async () => {
    const { db } = makeFakeDb([[agentRow()], [evalCaseRow()], []]);
    const container = containerWith(db, new MockLLMProvider('openai'));
    const service = new EvalsService(container);

    const dashboard = await service.getDashboard(WS, AGENT_ID);

    expect(dashboard?.current).toEqual({
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      traces_passed: 0,
      traces_total: 0,
      cost_usd: null,
    });
    expect(dashboard?.trend).toEqual([]);
    expect(dashboard?.alert).toBeNull();
  });
});
