/**
 * `RiskBriefService` — unit, no Docker (`specs/cross-cutting/pr-why-risk-brief/plan.md`
 * Work Item 7, spec §5/§6). A fake `Db` (mirrors `test/onboarding.test.ts`'s
 * `makeFakeDb`, extended to support rejecting a queued call by handing it an
 * `Error` instance) drives every `container.reviewRepo.*`/settings/`pr_brief`
 * read the service touches; `MockLLMProvider`/a minimal `FakeRepoIntel`/
 * `MockGitClient` from `src/adapters/mocks.ts` stand in for the LLM/repo-intel/
 * git ports. No real Postgres, LLM, or network anywhere in this file.
 */
import { describe, it, expect } from 'vitest';
import type { Db } from '../src/db/client.js';
import type { RiskBrief } from '@devdigest/shared';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import { NotFoundError } from '../src/platform/errors.js';
import { RiskBriefService } from '../src/modules/risk-brief/service.js';
import type {
  BlastResult,
  FileEdgeRow,
  FileRankRow,
  IndexResult,
  IndexState,
  RefRow,
  RepoIntel,
  RepoMapResult,
  SignatureRow,
  SymbolRow,
} from '../src/modules/repo-intel/types.js';

const config = () => loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const WS = 'ws-1';
const PR_ID = 'pr-1';
const REPO_ID = 'repo-1';

const pullRow = {
  id: PR_ID,
  workspaceId: WS,
  repoId: REPO_ID,
  number: 42,
  title: 'Add rate limiting to public API endpoints',
  author: 'marisa.koch',
  branch: 'feat/rate-limit',
  base: 'main',
  headSha: 'new-sha',
  lastReviewedSha: null,
  additions: 10,
  deletions: 2,
  filesCount: 1,
  status: 'needs_review',
  // Deliberately no `#<n>` reference — keeps the linked-issue fetch (and its
  // `container.github()` dependency) out of scope for these tests.
  body: 'Adds rate limiting to the public API.',
  openedAt: null,
  updatedAt: null,
};

const repoRow = {
  id: REPO_ID,
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
};

function validBrief(overrides: Partial<RiskBrief> = {}): RiskBrief {
  return {
    what: 'Adds rate limiting to public API endpoints.',
    why: 'Reduces abuse risk on unauthenticated routes.',
    risk_level: 'medium',
    risks: [],
    review_focus: [],
    pr_head_sha: 'new-sha',
    provider: 'openai',
    model: 'gpt-4.1',
    generated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const LLM_FIXTURE = {
  what: 'Adds rate limiting to public API endpoints.',
  why: 'Reduces abuse risk on unauthenticated routes.',
  risk_level: 'medium' as const,
  risks: [],
  review_focus: [],
};

// ---- fake Db (mirrors test/onboarding.test.ts's makeFakeDb; a queued Error
// instance rejects that call instead of resolving it) ------------------------

interface FakeCall {
  op: 'select' | 'insert';
  payload?: unknown;
}

function makeFakeDb(selectQueue: unknown[]): { db: Db; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let i = 0;
  function nextSelectResult(): unknown {
    if (i >= selectQueue.length) {
      throw new Error(`makeFakeDb: no queued select result for call #${i} (queue has ${selectQueue.length})`);
    }
    return selectQueue[i++];
  }
  function selectChain() {
    const c = {
      from() {
        return c;
      },
      where() {
        return c;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        try {
          const result = nextSelectResult();
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
  function insertChain(call: FakeCall) {
    const c = {
      values(payload: unknown) {
        call.payload = payload;
        return c;
      },
      onConflictDoUpdate() {
        return c;
      },
      returning() {
        return c;
      },
      then(resolve: (v: unknown) => void) {
        resolve([call.payload]);
      },
    };
    return c;
  }
  const db = {
    select: () => {
      calls.push({ op: 'select' });
      return selectChain();
    },
    insert: () => {
      const call: FakeCall = { op: 'insert' };
      calls.push(call);
      return insertChain(call);
    },
  } as unknown as Db;
  return { db, calls };
}

// ---- minimal fake RepoIntel (only getBlastRadius/getIndexState matter here) -

class FakeRepoIntel implements RepoIntel {
  constructor(private opts: { blast?: BlastResult; blastThrows?: boolean } = {}) {}
  async indexRepo(): Promise<IndexResult> {
    return { status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
  }
  async refreshIndex(): Promise<IndexResult> {
    return { status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
  }
  async getIndexState(): Promise<IndexState> {
    return {
      status: 'full',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: 0,
      repoId: REPO_ID,
      lastIndexedSha: 'sha1',
      indexerVersion: 1,
      languages: [],
      updatedAt: new Date(),
    };
  }
  async getBlastRadius(): Promise<BlastResult> {
    if (this.opts.blastThrows) throw new Error('repo-intel unavailable (mock)');
    return this.opts.blast ?? { changedSymbols: [], callers: [] };
  }
  async getRepoMap(): Promise<RepoMapResult> {
    return { text: '', tokens: 0, cached: true };
  }
  async getFileRank(): Promise<FileRankRow[]> {
    return [];
  }
  async getSymbolsInFiles(): Promise<SymbolRow[]> {
    return [];
  }
  async getCallerSignatures(): Promise<SignatureRow[]> {
    return [];
  }
  async getUnresolvedReferences(): Promise<RefRow[]> {
    return [];
  }
  async getConventionSamples(): Promise<string[]> {
    return [];
  }
  async getConventionSamplesStratified(): Promise<string[]> {
    return [];
  }
  async getFileContent(): Promise<string | null> {
    return null;
  }
  async getTopFilesByRank(): Promise<string[]> {
    return [];
  }
  async getCriticalPaths(): Promise<string[][]> {
    return [];
  }
  async getFileEdges(): Promise<FileEdgeRow[]> {
    return [];
  }
}

/** The 7-select sequence a fresh (non-cache-hit) `generate()` pass always
 *  consumes, in order: getPull, getByPrId(existing), getRepo, getIntent,
 *  BlastService's own getPull(dup), BlastService's own getPrFiles, and
 *  `resolveFeatureModel`'s settings read. */
function fullPipelineSelectQueue(opts: { existing?: unknown[]; intent?: unknown[]; settings?: unknown[] } = {}) {
  return [
    [pullRow],
    opts.existing ?? [],
    [repoRow],
    opts.intent ?? [],
    [pullRow],
    [],
    opts.settings ?? [],
  ];
}

describe('RiskBriefService.get (AC-1, AC-2, AC-3, AC-26)', () => {
  it('AC-3/AC-26 — an unknown/foreign-workspace PR id 404s', async () => {
    const { db } = makeFakeDb([[]]);
    const container = new Container(config(), db, {});
    const service = new RiskBriefService(container);

    await expect(service.get(WS, 'unknown-pr')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('AC-2 — no persisted brief returns null', async () => {
    const { db } = makeFakeDb([[pullRow], []]);
    const container = new Container(config(), db, {});
    const service = new RiskBriefService(container);

    await expect(service.get(WS, PR_ID)).resolves.toBeNull();
  });

  it('AC-1 — a persisted brief is returned verbatim', async () => {
    const brief = validBrief();
    const { db } = makeFakeDb([[pullRow], [{ prId: PR_ID, json: brief }]]);
    const container = new Container(config(), db, {});
    const service = new RiskBriefService(container);

    await expect(service.get(WS, PR_ID)).resolves.toEqual(brief);
  });
});

describe('RiskBriefService.generate — cache semantics (AC-4, AC-5, AC-6)', () => {
  it('AC-4 — a cache-hit (matching head_sha, not forced) returns the cached brief with zero LLM calls', async () => {
    const existing = validBrief({ pr_head_sha: 'new-sha' }); // matches pullRow.headSha
    const { db, calls } = makeFakeDb([[pullRow], [{ prId: PR_ID, json: existing }]]);
    const llm = new MockLLMProvider('openrouter');
    const container = new Container(config(), db, { llm: { openrouter: llm } });
    const service = new RiskBriefService(container);

    const result = await service.generate(WS, PR_ID, false);

    expect(result).toEqual({ brief: existing, cached: true });
    expect(llm.calls).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('AC-5 — a stale head_sha triggers exactly one LLM call and overwrites the row', async () => {
    const existing = validBrief({ pr_head_sha: 'old-sha' }); // stale vs pullRow.headSha === 'new-sha'
    const { db, calls } = makeFakeDb(fullPipelineSelectQueue({ existing: [{ prId: PR_ID, json: existing }] }));
    const llm = new MockLLMProvider('openrouter', { structured: LLM_FIXTURE });
    const repoIntel = new FakeRepoIntel();
    const container = new Container(config(), db, {
      llm: { openrouter: llm },
      repoIntel,
      git: new MockGitClient(),
    });
    const service = new RiskBriefService(container);

    const result = await service.generate(WS, PR_ID, false);

    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(result.cached).toBe(false);
    expect(result.brief?.pr_head_sha).toBe('new-sha');
    const insertPayload = calls.find((c) => c.op === 'insert')!.payload as { prId: string; json: RiskBrief };
    expect(insertPayload.prId).toBe(PR_ID);
    expect(insertPayload.json.pr_head_sha).toBe('new-sha');
  });

  it('AC-6 — force:true always regenerates, even on an otherwise-valid cache hit', async () => {
    const existing = validBrief({ pr_head_sha: 'new-sha' }); // would cache-hit if not forced
    const { db, calls } = makeFakeDb(fullPipelineSelectQueue({ existing: [{ prId: PR_ID, json: existing }] }));
    const llm = new MockLLMProvider('openrouter', { structured: LLM_FIXTURE });
    const container = new Container(config(), db, {
      llm: { openrouter: llm },
      repoIntel: new FakeRepoIntel(),
      git: new MockGitClient(),
    });
    const service = new RiskBriefService(container);

    const result = await service.generate(WS, PR_ID, true);

    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(result.cached).toBe(false);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });
});

describe('RiskBriefService.generate — best-effort upstream facts never block generation (§4/§5)', () => {
  it('Intent fetch throwing still proceeds to generate (one LLM call)', async () => {
    const { db } = makeFakeDb(fullPipelineSelectQueue({ intent: new Error('prIntent read failed (mock)') }));
    const llm = new MockLLMProvider('openrouter', { structured: LLM_FIXTURE });
    const container = new Container(config(), db, {
      llm: { openrouter: llm },
      repoIntel: new FakeRepoIntel(),
      git: new MockGitClient(),
    });
    const service = new RiskBriefService(container);

    const result = await service.generate(WS, PR_ID, false);

    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(result.brief).not.toBeNull();
  });

  it('a degraded Blast Radius response (degraded: true) proceeds with an empty blast section rather than throwing', async () => {
    const { db } = makeFakeDb(fullPipelineSelectQueue());
    const llm = new MockLLMProvider('openrouter', { structured: LLM_FIXTURE });
    const repoIntel = new FakeRepoIntel({
      blast: { changedSymbols: [], callers: [], degraded: true, reason: 'not_indexed' },
    });
    const container = new Container(config(), db, { llm: { openrouter: llm }, repoIntel, git: new MockGitClient() });
    const service = new RiskBriefService(container);

    const result = await service.generate(WS, PR_ID, false);

    expect(result.brief).not.toBeNull();
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
  });

  it('BlastService.getBlastRadius throwing outright also proceeds with an empty blast section', async () => {
    const { db } = makeFakeDb(fullPipelineSelectQueue());
    const llm = new MockLLMProvider('openrouter', { structured: LLM_FIXTURE });
    const repoIntel = new FakeRepoIntel({ blastThrows: true });
    const container = new Container(config(), db, { llm: { openrouter: llm }, repoIntel, git: new MockGitClient() });
    const service = new RiskBriefService(container);

    const result = await service.generate(WS, PR_ID, false);

    expect(result.brief).not.toBeNull();
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
  });
});

describe('RiskBriefService.generate — LLM failure (AC-14)', () => {
  it('an LLM throw leaves a pre-seeded valid persisted row completely unchanged on a subsequent get(), and returns degraded_reason: llm_failed', async () => {
    const existing = validBrief({ pr_head_sha: 'new-sha' });
    const { db, calls } = makeFakeDb([
      ...fullPipelineSelectQueue({ existing: [{ prId: PR_ID, json: existing }] }),
      // The subsequent get() call: getPull, getByPrId.
      [pullRow],
      [{ prId: PR_ID, json: existing }],
    ]);
    const llm = new MockLLMProvider('openrouter');
    llm.completeStructured = async () => {
      throw new Error('provider unreachable (mock)');
    };
    const container = new Container(config(), db, {
      llm: { openrouter: llm },
      repoIntel: new FakeRepoIntel(),
      git: new MockGitClient(),
    });
    const service = new RiskBriefService(container);

    // force:true bypasses the cache-hit so the LLM call is actually attempted.
    const result = await service.generate(WS, PR_ID, true);

    expect(result).toEqual({ brief: null, degraded_reason: 'llm_failed' });
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);

    const afterGet = await service.get(WS, PR_ID);
    expect(afterGet).toEqual(existing);
  });
});

describe('RiskBriefService.generate — model selection (AC-13)', () => {
  it('a workspace-level provider override in Settings is the one actually invoked', async () => {
    const settingsRow = {
      key: 'feature_models',
      value: { risk_brief: { provider: 'anthropic', model: 'claude-x' } },
    };
    const { db } = makeFakeDb(fullPipelineSelectQueue({ settings: [settingsRow] }));
    const llmOpenRouter = new MockLLMProvider('openrouter', { structured: LLM_FIXTURE }); // registry default — never called
    const llmAnthropic = new MockLLMProvider('anthropic', { structured: LLM_FIXTURE });
    const container = new Container(config(), db, {
      llm: { openrouter: llmOpenRouter, anthropic: llmAnthropic },
      repoIntel: new FakeRepoIntel(),
      git: new MockGitClient(),
    });
    const service = new RiskBriefService(container);

    const result = await service.generate(WS, PR_ID, false);

    expect(llmAnthropic.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(llmOpenRouter.calls).toHaveLength(0);
    expect(result.brief?.provider).toBe('anthropic');
    expect(result.brief?.model).toBe('claude-x');
  });
});
