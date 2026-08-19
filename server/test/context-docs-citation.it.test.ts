import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Review } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider, MockIntentDeriver } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import type { Db } from '../src/db/client.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context-docs-citation] Docker not available — skipping integration tests.');
}

/**
 * AC-37 end-to-end invariant-citation scenario (Work Item 16 of
 * docs/project-context-folder-plan.md, spec §6.9). Exercises the REAL
 * end-to-end stack — reindex (AC-1) → attach via
 * `AgentsRepository.setAgentContextDocEnabled` (Work Item 8) → a real run
 * through `ReviewRunExecutor`/`resolveContextDocs` (Work Item 10, already
 * wired at `run-executor.ts`) → persisted findings + trace — not a hand-
 * rolled simulation. The LLM is mocked (per the spec's own explicit
 * allowance: "a mocked-LLM version satisfying the plumbing is acceptable if
 * a real-model run is judged too flaky/costly for CI") to deterministically
 * return a finding whose `rationale` cites the attached document's filename.
 */

const INVARIANT_DOC_PATH = 'specs/architecture-invariants.md';
const INVARIANT_DOC_CONTENT =
  '# Architecture Invariants\n\nModule `api/` must not import `db/` directly. All ' +
  'database access must go through the `service/` layer.\n';

/**
 * A unified diff adding a violating `api/handler.ts` → `db/client` import.
 * Old range `-1,3`/new range `+1,4`: 1 context line, 1 added line (new line
 * 2), 2 more context lines — matches the added import at new-side line 2, so
 * the finding below (file `api/handler.ts`, lines 2-2) survives
 * `groundFindings`'s diff-hunk-intersection gate.
 */
const VIOLATING_DIFF = `diff --git a/api/handler.ts b/api/handler.ts
--- a/api/handler.ts
+++ b/api/handler.ts
@@ -1,3 +1,4 @@
 import { Router } from 'express';
+import { db } from '../db/client';

 export const handler = new Router();`;

/** The mocked model's Review — one finding whose rationale cites the attached
 *  invariant document by filename (AC-37's core assertion). */
const CITING_FINDING_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Direct api/ -> db/ import violates the documented architecture invariant.',
  score: 60,
  findings: [
    {
      id: 'f-invariant-violation',
      severity: 'WARNING',
      category: 'bug',
      title: 'api/ imports db/ directly',
      file: 'api/handler.ts',
      start_line: 2,
      end_line: 2,
      rationale:
        'This import violates the invariant stated in architecture-invariants.md: ' +
        'module `api/` must not import `db/` directly.',
      suggestion: 'Route this access through the service/ layer instead.',
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

d('AC-37 context-docs citation end-to-end', () => {
  let pg: PgFixture;
  let workspaceId: string;
  const clonePaths: string[] = [];

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  });
  afterAll(async () => {
    await pg?.stop();
    await Promise.all(clonePaths.map((p) => rm(p, { recursive: true, force: true })));
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: VIOLATING_DIFF }),
        github: new MockGitHubClient(),
        intentDeriver: new MockIntentDeriver(undefined),
        llm: { openai: new MockLLMProvider('openai', { structured: CITING_FINDING_FIXTURE }) },
      },
    });
  }

  async function makeFixtureClone(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'devdigest-context-docs-citation-it-'));
    clonePaths.push(root);
    for (const [rel, content] of Object.entries(files)) {
      const full = join(root, ...rel.split('/'));
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, content);
    }
    return root;
  }

  async function makeRepo(db: Db, fullName: string, clonePath: string) {
    const [owner, name] = fullName.split('/');
    const [row] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: owner!, name: name!, fullName, clonePath })
      .returning();
    return row!;
  }

  async function makePr(db: Db, repoId: string) {
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 501,
        title: 'Add direct db access from api handler',
        author: 'quinn.oyelaran',
        branch: 'feat/api-db-shortcut',
        base: 'main',
        headSha: 'deadbeef01',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'Wires api/handler.ts straight to the db client.',
      })
      .returning();
    return pr!;
  }

  it(
    'reindex -> attach -> run through the real run-executor produces a finding citing ' +
      'architecture-invariants.md, and the trace proves the citation plumbing (not just a lucky mock string)',
    async () => {
      const app = await makeApp();
      const { db } = pg.handle;

      // 1. Seed a fixture repo clone containing the invariant doc.
      const clonePath = await makeFixtureClone({ [INVARIANT_DOC_PATH]: INVARIANT_DOC_CONTENT });
      const repo = await makeRepo(db, 'acme/api-invariants', clonePath);

      // 2. Reindex so the document is discovered (AC-1, context_documents).
      const reindexRes = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/context-docs/reindex`,
      });
      expect(reindexRes.statusCode).toBe(200);
      const reindexBody = reindexRes.json();
      expect(reindexBody.documents.map((doc: { path: string }) => doc.path)).toContain(INVARIANT_DOC_PATH);

      // 3. Create a Security-Reviewer-type agent and attach the invariant doc
      // to it via the agents module's context-doc attach method (Work Item 8).
      const agentsRepo = new AgentsRepository(db);
      const agent = await agentsRepo.insert({
        workspaceId,
        name: 'Security Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'You are a security and architecture reviewer.',
      });
      await agentsRepo.setAgentContextDocEnabled(agent.id, repo.id, INVARIANT_DOC_PATH, true);
      const links = await agentsRepo.linkedContextDocs(agent.id, repo.id);
      expect(links).toMatchObject([{ path: INVARIANT_DOC_PATH, enabled: true }]);

      // 4. A PR fixture whose diff adds a violating api/ -> db/ import.
      const pr = await makePr(db, repo.id);

      // 5. Run the agent through the real run-executor.ts path (mocked LLM
      // returns a finding whose rationale cites the filename).
      const reviewRes = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      });
      expect(reviewRes.statusCode).toBe(200);
      const runId = reviewRes.json().runs[0].run_id as string;

      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      // 6a. The persisted review's findings include one whose rationale cites
      // the attached document's filename.
      const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
      expect(reviews).toHaveLength(1);
      const review = reviews[0];
      expect(review.findings.length).toBeGreaterThan(0);
      const citingFinding = review.findings.find((f: { rationale: string }) =>
        f.rationale.includes('architecture-invariants.md'),
      );
      expect(citingFinding).toBeDefined();

      // 6b. Separately, the run's trace proves the citation PLUMBING was
      // actually wired end-to-end — not just that the mocked response
      // happened to contain the right string.
      const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();

      // trace.specs_read names the actually-injected document path (AC-33).
      expect(trace.specs_read).toContain(INVARIANT_DOC_PATH);

      // The assembled `## Project context` block contains the document's
      // real content, path-labeled (AC-28/AC-29) — proves the file was
      // actually read off the clone and injected, not merely referenced.
      expect(trace.prompt_assembly.specs).toContain(`### ${INVARIANT_DOC_PATH}`);
      expect(trace.prompt_assembly.specs).toContain('must not import `db/` directly');

      // The AC-32 trusted citation-framing sentence was actually appended to
      // the assembled task/user text (server-composed, outside the untrusted
      // spec block) — proves the framing that WOULD let a real model cite
      // the doc is wired, not merely that this test's mock happened to.
      expect(trace.prompt_assembly.user).toContain('cite that document by its filename');

      await app.close();
    },
  );
});
