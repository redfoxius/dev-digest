/**
 * Conventions Extractor — Phase 7.3 empirical check (docs/go-language-support-plan.md):
 * the model-derived candidate pool (`server/src/modules/conventions/service.ts`'s
 * `extract()`, `origin: 'model'` path) was, before this test existed, never
 * exercised against a real Go repo — `conventions.it.test.ts` only ever uses
 * a `FakeRepoIntel` whose `getConventionSamples()` returns whatever the test
 * hardcodes, bypassing the real `RepoIntelService.getConventionSamples` →
 * `getTopFilesByRank` → `isJunkPath` pipeline entirely. This test runs a real
 * `runFullIndex` over a real Go fixture, then calls the REAL `repoIntel`
 * (not a fake) to answer two concrete open questions:
 *
 *  1. Does the model pool actually surface Go source files at all? (Expected
 *     yes — `getTopFilesByRank`/PageRank/the extraction prompt are all
 *     language-agnostic already, per the plan's root-cause analysis.)
 *  2. Do Go's `_test.go` files leak into the sample set as if they were
 *     ordinary house-style evidence? (`JUNK_PATH_PATTERNS`,
 *     `repo-intel/service.ts:755-770`, only recognizes `.test.`/`vitest.`/
 *     `jest.` — none of which match Go's `_test.go` suffix convention.)
 *
 * See Phase 7.5 for the fix to (2) once confirmed here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import { runFullIndex } from '../src/modules/repo-intel/pipeline/full.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const GO_MOD = `module example.com/greeter\n\ngo 1.22\n`;

const MAIN_GO = `package main

import "fmt"

// Greet returns a friendly, exclamation-terminated greeting for name.
func Greet(name string) string {
	return fmt.Sprintf("Hello, %s!", name)
}

func main() {
	fmt.Println(Greet("world"))
}
`;

const MAIN_TEST_GO = `package main

import "testing"

func TestGreet(t *testing.T) {
	if Greet("x") != "Hello, x!" {
		t.Fatal("unexpected greeting")
	}
}
`;

const GOLANGCI_YML = `linters:
  enable:
    - errcheck
    - gosec
`;

d('Conventions Extractor — model pool over a real Go repo (Testcontainers pg)', () => {
  let pg: PgFixture;
  let cloneDir: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId } = await seed(pg.handle.db);

    cloneDir = await mkdtemp(join(tmpdir(), 'devdigest-conventions-go-fixture-'));
    await writeFile(join(cloneDir, 'go.mod'), GO_MOD);
    await writeFile(join(cloneDir, 'main.go'), MAIN_GO);
    await writeFile(join(cloneDir, 'main_test.go'), MAIN_TEST_GO);
    await writeFile(join(cloneDir, '.golangci.yml'), GOLANGCI_YML);

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'greeter-conventions',
        fullName: 'acme/greeter-conventions',
        clonePath: cloneDir,
      })
      .returning();
    repoId = repo!.id;

    // Populate a real index + file_rank so getConventionSamples has
    // something non-fake to rank over — mirrors repo-intel-go.it.test.ts.
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const indexingApp = await buildApp({ config, db: pg.handle.db });
    const repository = new RepoIntelRepository(pg.handle.db);
    const result = await runFullIndex(indexingApp.container, repository, { repoId });
    expect(result.status).toBe('full');
    await indexingApp.close();
  });

  afterAll(async () => {
    await pg?.stop();
    if (cloneDir) await rm(cloneDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('samples ordinary Go source through the real (non-fake) getConventionSamples', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });
    const samples = await app.container.repoIntel.getConventionSamples(repoId, 12);
    expect(samples).toContain('main.go');
    await app.close();
  });

  it('excludes _test.go from convention sampling (Phase 7.5)', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });
    const samples = await app.container.repoIntel.getConventionSamples(repoId, 12);
    // Before Phase 7.5, this contained 'main_test.go' — confirmed
    // empirically (not just assumed from reading JUNK_PATH_PATTERNS) as a
    // real gap: none of `.test.`/`vitest.`/`jest.` match Go's `_test.go`
    // suffix convention. Fixed via `isLanguageTestFile`
    // (repo-intel/languages/index.ts), a per-language predicate alongside
    // the Phase 0 registry rather than a one-off substring pattern.
    expect(samples).not.toContain('main_test.go');
    expect(samples).toContain('main.go');
    await app.close();
  });

  it('extract() proposes a model-derived candidate from real Go file content, evidence-verified', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: {
              convention_candidates: {
                candidates: [
                  {
                    rule: 'Exported functions carry a doc comment starting with the function name.',
                    category: 'naming',
                    evidence_path: 'main.go',
                    evidence_snippet:
                      '// Greet returns a friendly, exclamation-terminated greeting for name.',
                    confidence: 0.8,
                  },
                ],
              },
            },
          }),
        },
        // repoIntel intentionally left un-overridden — the real service,
        // backed by the real DB rows runFullIndex just wrote, is the point.
      },
    });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const modelCandidates = body.candidates.filter((c: { origin: string }) => c.origin === 'model');
    expect(modelCandidates.length).toBe(1);
    expect(modelCandidates[0].evidence_path).toBe('main.go');
    expect(modelCandidates[0].evidence_line_start).toBeGreaterThan(0);
    await app.close();
  });

  it('extract() also produces config-derived candidates from go.mod and .golangci.yml (Phase 7.2)', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: { convention_candidates: { candidates: [] } },
          }),
        },
      },
    });
    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const configCandidates = res
      .json()
      .candidates.filter((c: { origin: string }) => c.origin === 'config' && c.evidence_path !== 'tsconfig.json');

    const goModCandidate = configCandidates.find((c: { evidence_path: string }) => c.evidence_path === 'go.mod');
    expect(goModCandidate?.rule).toContain('1.22');
    expect(goModCandidate?.status).toBe('accepted');
    expect(goModCandidate?.confidence).toBe(1);

    const linterRules = configCandidates
      .filter((c: { evidence_path: string }) => c.evidence_path === '.golangci.yml')
      .map((c: { rule: string }) => c.rule)
      .join(' ');
    expect(linterRules).toContain('errcheck');
    expect(linterRules).toContain('gosec');
    await app.close();
  });
});
