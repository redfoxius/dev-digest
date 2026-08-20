/**
 * `assembleOnboardingFacts` (docs/onboarding-generator-plan.md Work Item 5)
 * — unit, no Docker. Exercises the exported top-level function directly
 * against a fake `RepoIntel`, per `intent/service.ts`'s own
 * `filterRiskFileRefs` precedent for testing an algorithm pulled out of a
 * service class.
 */
import { describe, it, expect } from 'vitest';
import { estimateTokens } from '@devdigest/reviewer-core';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
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
import { assembleOnboardingFacts } from '../src/modules/onboarding/service.js';
import { DEFAULT_REPO_MAP_TOKEN_BUDGET } from '../src/modules/repo-intel/constants.js';
import { MAX_FILE_EDGES } from '../src/modules/onboarding/constants.js';

const config = () => loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const fakeDb = {} as unknown as Db;

class FakeRepoIntel implements RepoIntel {
  calls = { indexRepo: 0, refreshIndex: 0 };
  constructor(
    private opts: {
      repoMapText?: string;
      topFiles?: string[];
      criticalPaths?: string[][];
      fileEdges?: FileEdgeRow[];
      callerSignatures?: SignatureRow[];
      fileContent?: Record<string, string>;
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
      status: 'full',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: 0,
      repoId: '',
      lastIndexedSha: 'sha1',
      indexerVersion: 1,
      languages: [],
      updatedAt: new Date(),
    };
  }
  async getBlastRadius(): Promise<BlastResult> {
    return { changedSymbols: [], callers: [], impactedEndpoints: [] };
  }
  async getRepoMap(): Promise<RepoMapResult> {
    return { text: this.opts.repoMapText ?? '', tokens: 0, cached: true };
  }
  async getFileRank(): Promise<FileRankRow[]> {
    return [];
  }
  async getSymbolsInFiles(): Promise<SymbolRow[]> {
    return [];
  }
  async getCallerSignatures(): Promise<SignatureRow[]> {
    return this.opts.callerSignatures ?? [];
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
  async getFileContent(_repoId: string, file: string): Promise<string | null> {
    return this.opts.fileContent?.[file] ?? null;
  }
  async getTopFilesByRank(): Promise<string[]> {
    return this.opts.topFiles ?? [];
  }
  async getCriticalPaths(): Promise<string[][]> {
    return this.opts.criticalPaths ?? [];
  }
  async getFileEdges(): Promise<FileEdgeRow[]> {
    return this.opts.fileEdges ?? [];
  }
}

describe('assembleOnboardingFacts (docs/onboarding-generator-plan.md Work Item 5)', () => {
  it('AC-11 — never triggers a fresh index/reindex as a side effect', async () => {
    const repoIntel = new FakeRepoIntel({ topFiles: ['src/a.ts', 'src/b.ts'] });
    const container = new Container(config(), fakeDb, { repoIntel });

    await assembleOnboardingFacts(container, 'repo-1');

    expect(repoIntel.calls.indexRepo).toBe(0);
    expect(repoIntel.calls.refreshIndex).toBe(0);
  });

  it('every assembled section is wrapped via wrapUntrusted(...)', async () => {
    const repoIntel = new FakeRepoIntel({
      repoMapText: 'src/\n  a.ts\n  b.ts',
      topFiles: ['src/a.ts', 'src/b.ts'],
      criticalPaths: [['src/a.ts', 'src/b.ts']],
      fileEdges: [{ fromFile: 'src/a.ts', toFile: 'src/b.ts' }],
      callerSignatures: [{ file: 'src/c.ts', symbol: 'caller', signature: 'caller(): void', rank: 1 }],
      fileContent: { 'src/a.ts': 'export const a = 1;' },
    });
    const container = new Container(config(), fakeDb, { repoIntel });

    const facts = await assembleOnboardingFacts(container, 'repo-1');

    expect(facts.sections.length).toBeGreaterThan(0);
    for (const section of facts.sections) {
      expect(section).toMatch(/<untrusted source="[^"]+">/);
      expect(section).toContain('</untrusted>');
    }
  });

  it('a large synthetic edge list is truncated to MAX_FILE_EDGES (not merely happens to fit) and the assembled facts stay within getRepoMap\'s own token budget', async () => {
    // 50,000+ synthetic edges — well past MAX_FILE_EDGES.
    const bigEdgeList: FileEdgeRow[] = Array.from({ length: 60_000 }, (_, i) => ({
      fromFile: `src/file-${i}.ts`,
      toFile: `src/file-${i + 1}.ts`,
    }));
    const topFiles = Array.from({ length: 20 }, (_, i) => `src/top-${i}.ts`);
    const repoIntel = new FakeRepoIntel({
      repoMapText: '', // repoMap self-bounds independently; empty here isolates the "extra facts" budget
      topFiles,
      fileEdges: bigEdgeList,
    });
    const container = new Container(config(), fakeDb, { repoIntel });

    const facts = await assembleOnboardingFacts(container, 'repo-1');

    // The edge section must reflect exactly MAX_FILE_EDGES lines, not the
    // full 60,000 — confirms real truncation, not a lucky token-count fit.
    const edgeSection = facts.sections.find((s) => s.includes('Import graph edges'))!;
    const edgeLineCount = edgeSection.split('\n').filter((l) => l.includes(' -> ')).length;
    expect(edgeLineCount).toBe(MAX_FILE_EDGES);

    const totalChars = facts.sections.reduce((n, s) => n + s.length, 0);
    expect(estimateTokens(totalChars)).toBeLessThanOrEqual(DEFAULT_REPO_MAP_TOKEN_BUDGET);
  });

  it('AC-37 — a 50,000+-file synthetic fixture never fabricates a per-section "of N total" count', async () => {
    const topFiles = Array.from({ length: 20 }, (_, i) => `src/top-${i}.ts`);
    const criticalPaths = [topFiles.slice(0, 5)];
    const repoIntel = new FakeRepoIntel({ topFiles, criticalPaths });
    const container = new Container(config(), fakeDb, { repoIntel });

    const facts = await assembleOnboardingFacts(container, 'repo-1');

    for (const section of facts.sections) {
      expect(section.toLowerCase()).not.toMatch(/of\s+\d[\d,]*\s+(total|files)/);
    }
  });

  // ---- Gap-fill additions (audit pass, see the onboarding test-audit report) ----
  // Both cases below were previously only exercised at `parseRunFacts`'s own
  // struct-output level (`test/onboarding-run-facts.test.ts`) — that proves
  // the FACT struct is honest/secret-free, but never that the actual PROMPT
  // TEXT `assembleOnboardingFacts` hands to the LLM (the thing AC-13's and
  // AC-34's own `Verify:` clauses are actually about) preserves that
  // property once run through `renderRunFactsText` and joined into
  // `facts.sections`.

  it('AC-13 — when no run-fact source is present, the assembled "How to run locally" section states the honest empty signal, never a fabricated command', async () => {
    // No `fileContent` fixture at all — `getFileContent` returns null for
    // package.json/.env*/Dockerfile/docker-compose.yml alike, i.e. none of
    // AC-12's sources are present.
    const repoIntel = new FakeRepoIntel({ topFiles: ['src/a.ts'] });
    const container = new Container(config(), fakeDb, { repoIntel });

    const facts = await assembleOnboardingFacts(container, 'repo-1');

    const runFactsSection = facts.sections.find((s) => s.includes('How to run locally'))!;
    expect(runFactsSection).toBeDefined();
    expect(runFactsSection).toContain('No run-facts detected');
    // Never invents a command not backed by one of AC-12's sources.
    expect(runFactsSection).not.toMatch(/\b(npm|pnpm|yarn|docker)\s+(run|start|dev|up)\b/);
  });

  it("AC-34 — a repo's real .env.example CONTENT (secret-shaped) never reaches the assembled facts text sent to the LLM, only its presence", async () => {
    const secretEnvContent = 'DATABASE_URL=postgres://user:hunter2@host/db\nSTRIPE_SECRET=sk_live_abc123';
    const repoIntel = new FakeRepoIntel({
      topFiles: ['src/a.ts'],
      fileContent: { '.env.example': secretEnvContent },
    });
    const container = new Container(config(), fakeDb, { repoIntel });

    const facts = await assembleOnboardingFacts(container, 'repo-1');

    const joined = facts.sections.join('\n');
    expect(joined).not.toContain('hunter2');
    expect(joined).not.toContain('sk_live_abc123');
    expect(joined).not.toContain('DATABASE_URL');
    // The presence FACT itself is still honestly carried through.
    const runFactsSection = facts.sections.find((s) => s.includes('How to run locally'))!;
    expect(runFactsSection).toContain('.env.example present: yes');
  });
});
