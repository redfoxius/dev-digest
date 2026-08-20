/**
 * OnboardingService — unit, no Docker (docs/onboarding-generator-plan.md Work
 * Item 9). `ContainerOverrides` with a fake `repoIntel`/`llm`, mirroring
 * `conventions.it.test.ts`'s `FakeRepoIntel`/`intent/service.ts`'s
 * `MockIntentDeriver` test-injection shape. A minimal queue-based fake `Db`
 * (mirrors `test/skills.test.ts`'s `makeFakeDb`) drives `reposRepo.getById`,
 * `resolveFeatureModel`'s settings read, and `OnboardingRepository.upsert`.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { NotFoundError, NotIndexedError, ExternalServiceError } from '../src/platform/errors.js';
import { OnboardingService } from '../src/modules/onboarding/service.js';
import { ONBOARDING_SECTION_KINDS } from '../src/modules/onboarding/constants.js';
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
import type { Onboarding } from '@devdigest/shared';

const config = () => loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const WS = 'ws-1';
const REPO_ID = 'repo-1';

const repoRow = {
  id: REPO_ID,
  workspaceId: WS,
  owner: 'acme',
  name: 'widgets',
  fullName: 'acme/widgets',
  defaultBranch: 'main',
  clonePath: '/clones/acme-widgets',
  contextSearchGlobs: null,
  lastPolledAt: null,
  createdBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const noopLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

// ---- fake Db (mirrors test/skills.test.ts's makeFakeDb) -------------------

interface FakeCall {
  op: 'select' | 'insert';
  table?: unknown;
  payload?: unknown;
}

/**
 * `select()` calls consume from `selectQueue` in order (mirrors
 * `test/skills.test.ts`'s `makeFakeDb`). `insert()` calls (this module's
 * only write — `OnboardingRepository.upsert`) instead echo back whatever
 * `.values(...)` was actually given, wrapped in an array — a truer stand-in
 * for a real `.returning()` than a hand-queued fixture, and it means each
 * test only has to queue results for the `select`s it actually expects
 * (`reposRepo.getById`, `resolveFeatureModel`'s settings read,
 * `OnboardingRepository.getByRepoId`), not the write.
 */
function makeFakeDb(selectQueue: unknown[]): { db: Db; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let i = 0;
  function nextSelectResult(): unknown {
    if (i >= selectQueue.length) {
      throw new Error(`makeFakeDb: no queued select result for call #${i} (queue has ${selectQueue.length})`);
    }
    return selectQueue[i++];
  }
  function selectChain(call: FakeCall) {
    const c = {
      from(table: unknown) {
        call.table ??= table;
        return c;
      },
      where() {
        return c;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        try {
          resolve(nextSelectResult());
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
      const call: FakeCall = { op: 'select' };
      calls.push(call);
      return selectChain(call);
    },
    insert: () => {
      const call: FakeCall = { op: 'insert' };
      calls.push(call);
      return insertChain(call);
    },
  } as unknown as Db;
  return { db, calls };
}

// ---- fake RepoIntel ---------------------------------------------------------

class FakeRepoIntel implements RepoIntel {
  calls = { indexRepo: 0, refreshIndex: 0 };
  constructor(
    private opts: {
      lastIndexedSha?: string;
      filesIndexed?: number;
      topFiles?: string[];
      stallGetRepoMap?: boolean;
    } = {},
  ) {}

  async indexRepo(): Promise<IndexResult> {
    this.calls.indexRepo++;
    return { status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
  }
  async refreshIndex(): Promise<IndexResult> {
    this.calls.refreshIndex++;
    return { status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
  }
  async getIndexState(): Promise<IndexState> {
    return {
      status: this.opts.lastIndexedSha ? 'full' : 'degraded',
      filesIndexed: this.opts.filesIndexed ?? 42,
      filesSkipped: 0,
      durationMs: 0,
      repoId: REPO_ID,
      lastIndexedSha: this.opts.lastIndexedSha ?? '',
      indexerVersion: 1,
      languages: [],
      updatedAt: new Date(),
    };
  }
  async getBlastRadius(): Promise<BlastResult> {
    return { changedSymbols: [], callers: [], impactedEndpoints: [] };
  }
  async getRepoMap(): Promise<RepoMapResult> {
    if (this.opts.stallGetRepoMap) return new Promise(() => {}); // never resolves
    return { text: 'src/\n  index.ts', tokens: 10, cached: true };
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
    return this.opts.topFiles ?? ['src/index.ts', 'src/app.ts'];
  }
  async getCriticalPaths(): Promise<string[][]> {
    return [];
  }
  async getFileEdges(): Promise<FileEdgeRow[]> {
    return [];
  }
}

function fixtureTour(overrides: Partial<Record<(typeof ONBOARDING_SECTION_KINDS)[number], object>> = {}): Onboarding {
  return {
    sections: ONBOARDING_SECTION_KINDS.map((kind) => ({
      kind,
      title: `Title for ${kind}`,
      body: `Body for ${kind}`,
      diagram: null,
      links: [],
      ...(overrides[kind] ?? {}),
    })),
  };
}

describe('OnboardingService.get (AC-1, AC-2, AC-3, AC-4)', () => {
  it('AC-1 — no persisted tour returns tour:null, zero LLM calls', async () => {
    const { db } = makeFakeDb([[repoRow], []]);
    const llm = new MockLLMProvider('openai');
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'sha1' });
    const container = new Container(config(), db, { repoIntel, llm: { openrouter: llm } });
    const service = new OnboardingService(container);

    const res = await service.get(WS, REPO_ID);

    expect(res).toEqual({
      tour: null,
      indexed_sha: null,
      file_count: null,
      generated_at: null,
      provider: null,
      model: null,
      stale: false,
    });
    expect(llm.calls).toHaveLength(0);
  });

  it('AC-2 — a persisted tour is returned verbatim, zero LLM calls; AC-4 — stale reflects a mismatched indexed_sha', async () => {
    const tour = fixtureTour();
    const persistedRow = {
      repoId: REPO_ID,
      json: tour,
      generatedAt: new Date('2026-08-01T00:00:00Z'),
      indexedSha: 'old-sha',
      fileCount: 10,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      tokensIn: 100,
      tokensOut: 200,
      costUsd: '0.01',
    };
    const { db } = makeFakeDb([[repoRow], [persistedRow]]);
    const llm = new MockLLMProvider('openai');
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'new-sha' });
    const container = new Container(config(), db, { repoIntel, llm: { openrouter: llm } });
    const service = new OnboardingService(container);

    const res = await service.get(WS, REPO_ID);

    expect(res.tour).toEqual(tour);
    expect(res.indexed_sha).toBe('old-sha');
    expect(res.stale).toBe(true); // 'old-sha' !== repoIntel's current 'new-sha'
    expect(llm.calls).toHaveLength(0);
  });

  it('AC-4 — stale is false when the persisted indexed_sha matches the current index state', async () => {
    const persistedRow = {
      repoId: REPO_ID,
      json: fixtureTour(),
      generatedAt: new Date(),
      indexedSha: 'sha-match',
      fileCount: 10,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      tokensIn: 100,
      tokensOut: 200,
      costUsd: null,
    };
    const { db } = makeFakeDb([[repoRow], [persistedRow]]);
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'sha-match' });
    const container = new Container(config(), db, { repoIntel, llm: {} });
    const service = new OnboardingService(container);

    const res = await service.get(WS, REPO_ID);
    expect(res.stale).toBe(false);
  });

  it('AC-3/AC-33 — an unknown/cross-workspace repo id 404s', async () => {
    const { db } = makeFakeDb([[]]); // getById resolves to no rows
    const container = new Container(config(), db, { repoIntel: new FakeRepoIntel(), llm: {} });
    const service = new OnboardingService(container);

    await expect(service.get(WS, 'unknown-repo')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('OnboardingService.regenerate (AC-5..AC-10, AC-15, AC-16, AC-18, AC-19, AC-28..AC-30)', () => {
  it('AC-5/AC-7 — exactly one completeStructured call per Regenerate; two consecutive calls each independently invoke once', async () => {
    const { db } = makeFakeDb([
      [repoRow], [[]], // call 1: getById, settings
      [repoRow], [[]], // call 2: getById, settings
    ]);
    const llm = new MockLLMProvider('openai', { structured: fixtureTour() });
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'sha1' });
    const container = new Container(config(), db, { repoIntel, llm: { openrouter: llm } });
    const service = new OnboardingService(container);

    await service.regenerate(WS, REPO_ID, noopLog);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await service.regenerate(WS, REPO_ID, noopLog);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(2);
  });

  it('AC-15 — the rendered system prompt lists exactly the 5 fixed kinds, in fixed order', async () => {
    const { db } = makeFakeDb([[repoRow], [[]]]);
    const llm = new MockLLMProvider('openai', { structured: fixtureTour() });
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'sha1' });
    const container = new Container(config(), db, { repoIntel, llm: { openrouter: llm } });
    const service = new OnboardingService(container);

    await service.regenerate(WS, REPO_ID, noopLog);

    const call = llm.calls.find((c) => c.method === 'completeStructured')!;
    const systemMsg = (call.req as { messages: { role: string; content: string }[] }).messages.find(
      (m) => m.role === 'system',
    )!;
    const indices = ONBOARDING_SECTION_KINDS.map((k) => systemMsg.content.indexOf(`kind="${k}"`));
    expect(indices.every((i) => i !== -1)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b)); // strictly ascending = fixed order
  });

  it('AC-6 — Regenerate on a never-indexed repo rejects 422, zero LLM calls, no row change', async () => {
    const { db, calls } = makeFakeDb([[repoRow]]); // only getById is expected to run
    const llm = new MockLLMProvider('openai', { structured: fixtureTour() });
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: '' }); // unresolved
    const container = new Container(config(), db, { repoIntel, llm: { openrouter: llm } });
    const service = new OnboardingService(container);

    await expect(service.regenerate(WS, REPO_ID, noopLog)).rejects.toBeInstanceOf(NotIndexedError);
    expect(llm.calls).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('AC-9 — an LLM failure responds 502 and never writes the onboarding row', async () => {
    const { db, calls } = makeFakeDb([[repoRow], [[]]]); // getById, settings — no insert expected
    const llm = new MockLLMProvider('openai');
    llm.completeStructured = vi.fn().mockRejectedValue(new Error('provider unreachable'));
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'sha1' });
    const container = new Container(config(), db, { repoIntel, llm: { openrouter: llm } });
    const service = new OnboardingService(container);

    await expect(service.regenerate(WS, REPO_ID, noopLog)).rejects.toBeInstanceOf(ExternalServiceError);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('AC-38 — facts assembly exceeding 20,000ms aborts with 502, zero LLM calls, no row change', async () => {
    vi.useFakeTimers();
    try {
      const { db, calls } = makeFakeDb([[repoRow]]); // only getById expected
      const llm = new MockLLMProvider('openai', { structured: fixtureTour() });
      const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'sha1', stallGetRepoMap: true });
      const container = new Container(config(), db, { repoIntel, llm: { openrouter: llm } });
      const service = new OnboardingService(container);

      const pending = service.regenerate(WS, REPO_ID, noopLog).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(20_001);
      const err = await pending;

      expect(err).toBeInstanceOf(ExternalServiceError);
      expect(llm.calls).toHaveLength(0);
      expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('AC-16 — a diagram on a non-architecture section is nulled server-side; architecture keeps its own', async () => {
    const tour = fixtureTour({
      architecture: { diagram: 'flowchart TD\nA-->B' },
      how_to_run: { diagram: 'flowchart TD\nX-->Y' },
    });
    const { db, calls } = makeFakeDb([[repoRow], [[]]]);
    const llm = new MockLLMProvider('openai', { structured: tour });
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'sha1' });
    const container = new Container(config(), db, { repoIntel, llm: { openrouter: llm } });
    const service = new OnboardingService(container);

    const res = await service.regenerate(WS, REPO_ID, noopLog);

    const architecture = res.tour!.sections.find((s) => s.kind === 'architecture')!;
    const howToRun = res.tour!.sections.find((s) => s.kind === 'how_to_run')!;
    expect(architecture.diagram).toBe('flowchart TD\nA-->B');
    expect(howToRun.diagram).toBeNull();
    const insertPayload = calls.find((c) => c.op === 'insert')!.payload as { json: Onboarding };
    expect(insertPayload.json.sections.find((s) => s.kind === 'how_to_run')!.diagram).toBeNull();
  });

  it('AC-18 — an 8,000-char body is truncated to exactly 6,000 chars plus the marker', async () => {
    const longBody = 'x'.repeat(8000);
    const tour = fixtureTour({ architecture: { body: longBody } });
    const { db } = makeFakeDb([[repoRow], [[]]]);
    const llm = new MockLLMProvider('openai', { structured: tour });
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'sha1' });
    const container = new Container(config(), db, { repoIntel, llm: { openrouter: llm } });
    const service = new OnboardingService(container);

    const res = await service.regenerate(WS, REPO_ID, noopLog);
    const architecture = res.tour!.sections.find((s) => s.kind === 'architecture')!;
    expect(architecture.body).toBe(`${'x'.repeat(6000)}...[truncated]`);
  });

  it('AC-19 — a fabricated link path is dropped; a real (facts-grounded) path survives', async () => {
    const tour = fixtureTour({
      critical_paths: {
        links: [
          { label: 'Entry point', path: 'src/index.ts' }, // real — present in FakeRepoIntel's topFiles
          { label: 'Fabricated', path: 'src/does-not-exist.ts' },
        ],
      },
    });
    const { db } = makeFakeDb([[repoRow], [[]]]);
    const llm = new MockLLMProvider('openai', { structured: tour });
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'sha1', topFiles: ['src/index.ts', 'src/app.ts'] });
    const container = new Container(config(), db, { repoIntel, llm: { openrouter: llm } });
    const service = new OnboardingService(container);

    const res = await service.regenerate(WS, REPO_ID, noopLog);
    const criticalPaths = res.tour!.sections.find((s) => s.kind === 'critical_paths')!;
    expect(criticalPaths.links).toEqual([{ label: 'Entry point', path: 'src/index.ts' }]);
  });

  it('AC-28 — a workspace feature-model override picks a non-default provider', async () => {
    const settingsRow = { key: 'feature_models', value: { onboarding: { provider: 'openai', model: 'gpt-4.1' } } };
    const { db } = makeFakeDb([[repoRow], [settingsRow]]);
    const llmOpenAI = new MockLLMProvider('openai', { structured: fixtureTour() });
    const llmOpenRouter = new MockLLMProvider('openai', { structured: fixtureTour() }); // never called
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'sha1' });
    const container = new Container(config(), db, { repoIntel, llm: { openai: llmOpenAI, openrouter: llmOpenRouter } });
    const service = new OnboardingService(container);

    await service.regenerate(WS, REPO_ID, noopLog);

    expect(llmOpenAI.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(llmOpenRouter.calls).toHaveLength(0);
  });

  it('AC-29 — a successful Regenerate records provider/model/token usage (non-null)', async () => {
    const { db, calls } = makeFakeDb([[repoRow], [[]]]);
    const llm = new MockLLMProvider('openai', { structured: fixtureTour() });
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'sha1', filesIndexed: 77 });
    const container = new Container(config(), db, { repoIntel, llm: { openrouter: llm } });
    const service = new OnboardingService(container);

    const res = await service.regenerate(WS, REPO_ID, noopLog);

    expect(res.provider).toBe('openrouter');
    expect(res.model).toBe('deepseek/deepseek-v4-flash');
    expect(res.file_count).toBe(77);
    const insertPayload = calls.find((c) => c.op === 'insert')!.payload as {
      tokensIn: number;
      tokensOut: number;
      provider: string;
      model: string;
    };
    expect(insertPayload.tokensIn).not.toBeNull();
    expect(insertPayload.tokensOut).not.toBeNull();
    expect(insertPayload.provider).toBe('openrouter');
    expect(insertPayload.model).toBe('deepseek/deepseek-v4-flash');
  });

  it('AC-30 — the completeStructured call omits an explicit timeoutMs override (defers to the adapter default)', async () => {
    const { db } = makeFakeDb([[repoRow], [[]]]);
    const llm = new MockLLMProvider('openai', { structured: fixtureTour() });
    const repoIntel = new FakeRepoIntel({ lastIndexedSha: 'sha1' });
    const container = new Container(config(), db, { repoIntel, llm: { openrouter: llm } });
    const service = new OnboardingService(container);

    await service.regenerate(WS, REPO_ID, noopLog);

    const call = llm.calls.find((c) => c.method === 'completeStructured')!;
    expect((call.req as { timeoutMs?: number }).timeoutMs).toBeUndefined();
  });

  it('AC-3/AC-33 — an unknown/cross-workspace repo id 404s on Regenerate too', async () => {
    const { db } = makeFakeDb([[]]);
    const llm = new MockLLMProvider('openai');
    const container = new Container(config(), db, { repoIntel: new FakeRepoIntel(), llm: { openrouter: llm } });
    const service = new OnboardingService(container);

    await expect(service.regenerate(WS, 'unknown-repo', noopLog)).rejects.toBeInstanceOf(NotFoundError);
    expect(llm.calls).toHaveLength(0);
  });
});
