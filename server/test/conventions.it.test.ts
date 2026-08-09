import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type {
  BlastResult,
  IndexResult,
  IndexState,
  RepoMapResult,
  RefRow,
  SignatureRow,
  SymbolRow,
  FileRankRow,
} from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * A minimal `RepoIntel` fake — only `getConventionSamples`/`getFileContent`
 * are exercised by the conventions module; every other method is stubbed to
 * a degraded-but-valid default (mirrors how the real service degrades when
 * a repo is unindexed), matching `ContainerOverrides.repoIntel`'s contract.
 */
class FakeRepoIntel implements RepoIntel {
  constructor(private files: Record<string, string>, private sampleFiles: string[] = []) {}

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
      repoId: '',
      lastIndexedSha: '',
      indexerVersion: 1,
      languages: [],
      updatedAt: new Date(),
    };
  }
  async getBlastRadius(): Promise<BlastResult> {
    return { changedSymbols: [], callers: [], impactedEndpoints: [] };
  }
  async getRepoMap(): Promise<RepoMapResult> {
    return { text: '', tokens: 0, cached: false };
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
    return this.sampleFiles;
  }
  async getConventionSamplesStratified(): Promise<string[]> {
    return this.sampleFiles;
  }
  async getFileContent(_repoId: string, file: string): Promise<string | null> {
    return this.files[file] ?? null;
  }
  async getTopFilesByRank(): Promise<string[]> {
    return [];
  }
  async getCriticalPaths(): Promise<string[][]> {
    return [];
  }
}

/**
 * End-to-end coverage for `/repos/:id/conventions*` over a real Postgres
 * (testcontainers): config-derived candidates persist without a model call,
 * model-derived candidates persist only when their evidence verifies, a
 * re-scan never touches already-triaged rows and dedups, and
 * `createSkillFromCandidates` only ever bundles `status: 'accepted'` rows.
 */
d('/repos/:id/conventions', () => {
  let pg: PgFixture;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    // `seed()` already inserts the demo repo `acme/payments-api` — reuse it
    // rather than inserting a second row (its `(workspace_id, full_name)`
    // pair is unique).
    await seed(pg.handle.db);
    const [repo] = await pg.handle.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const SAMPLE_FILE = 'src/api/users.ts';
  const SAMPLE_CONTENT = [
    'import { db } from "./db";',
    '',
    'export async function getUser(id: string) {',
    '  const user = await db.users.find(id);',
    '  return user;',
    '}',
  ].join('\n');

  function makeApp(opts: { files: Record<string, string>; samples?: string[]; llmCandidates?: unknown[] }) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        repoIntel: new FakeRepoIntel(opts.files, opts.samples ?? []),
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: {
              convention_candidates: { candidates: opts.llmCandidates ?? [] },
            },
          }),
        },
      },
    });
  }

  it('extract persists a config-derived candidate with no model call needed to survive', async () => {
    const app = await makeApp({
      files: { 'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }) },
      samples: [],
    });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const configCandidates = body.candidates.filter((c: { origin: string }) => c.origin === 'config');
    expect(configCandidates.length).toBeGreaterThan(0);
    expect(configCandidates[0].status).toBe('accepted');
    expect(configCandidates[0].confidence).toBe(1);
  });

  it('extract discards a model candidate whose evidence cannot be verified in the file', async () => {
    const app = await makeApp({
      files: { [SAMPLE_FILE]: SAMPLE_CONTENT },
      samples: [SAMPLE_FILE],
      llmCandidates: [
        {
          rule: 'Verifiable rule',
          category: 'error-handling',
          evidence_path: SAMPLE_FILE,
          evidence_snippet: '  const user = await db.users.find(id);',
          confidence: 0.9,
        },
        {
          rule: 'Hallucinated rule',
          category: 'error-handling',
          evidence_path: SAMPLE_FILE,
          evidence_snippet: 'this snippet does not exist anywhere in the file',
          confidence: 0.8,
        },
      ],
    });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const modelCandidates = body.candidates.filter((c: { origin: string }) => c.origin === 'model');
    expect(modelCandidates.length).toBe(1);
    expect(modelCandidates[0].rule).toBe('Verifiable rule');
    expect(modelCandidates[0].evidence_line_start).toBeGreaterThan(0);
  });

  it('re-scan never touches an already-triaged row and dedups against it', async () => {
    const app = await makeApp({
      files: { 'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }) },
      samples: [],
    });
    const first = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const firstCandidate = first.json().candidates.find((c: { origin: string }) => c.origin === 'config');

    // Triage it (reject).
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${firstCandidate.id}`,
      payload: { status: 'rejected' },
    });

    // Re-scan the same repo/config — must not resurrect or duplicate the row.
    const second = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const rows = second.json().candidates.filter((c: { id: string }) => c.id === firstCandidate.id);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('rejected');

    const sameRuleDuplicates = second
      .json()
      .candidates.filter((c: { rule: string; evidence_path: string }) =>
        c.rule === firstCandidate.rule && c.evidence_path === firstCandidate.evidence_path,
      );
    expect(sameRuleDuplicates.length).toBe(1);
  });

  it('buildSkillDraft names the skill after the repo, not its raw id', async () => {
    const app = await makeApp({
      files: { 'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }) },
      samples: [],
    });
    const extractRes = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const candidate = (extractRes.json().candidates as { id: string }[])[0]!;
    // Explicitly accept rather than relying on a fresh candidate's default
    // status — this repo's rows accumulate across earlier tests in this
    // file, some of which reject candidates that dedupe against this one.
    await app.inject({ method: 'PATCH', url: `/conventions/${candidate.id}`, payload: { status: 'accepted' } });

    const draftRes = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill-draft`,
      payload: { candidate_ids: [candidate.id] },
    });
    expect(draftRes.statusCode).toBe(200);
    const draft = draftRes.json();
    // Seeded repo is `acme/payments-api` — the name must be slugified from
    // that, not `${repoId}-conventions` (the raw UUID prefix this regressed
    // to before).
    expect(draft.name).toBe('acme-payments-api-conventions');
    expect(draft.body).toContain('# acme-payments-api-conventions');
  });

  it('createSkillFromCandidates only bundles accepted rows even if a rejected id is included', async () => {
    const app = await makeApp({
      files: { 'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noImplicitAny: true } }) },
      samples: [],
    });
    const extractRes = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const candidates = extractRes.json().candidates as { id: string; status: string }[];
    expect(candidates.length).toBeGreaterThanOrEqual(2);

    // Pick explicitly by current status rather than array position — this
    // repo's row set accumulates across earlier tests in this file, so
    // positional destructuring would be flaky.
    const keep = candidates.find((c) => c.status === 'accepted')!;
    const other = candidates.find((c) => c.id !== keep.id)!;
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${other.id}`,
      payload: { status: 'rejected' },
    });

    const skillRes = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: {
        candidate_ids: [keep.id, other.id],
        name: 'test-repo-conventions',
        body: '# test-repo-conventions\n\nSome body.',
        type: 'convention',
        enabled: true,
      },
    });
    expect(skillRes.statusCode).toBe(201);
    const skill = skillRes.json();
    expect(skill.source).toBe('extracted');
    expect(skill.enabled).toBe(true);
  });
});
