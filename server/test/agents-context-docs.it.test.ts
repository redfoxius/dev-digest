import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsService } from '../src/modules/agents/service.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import type { Container } from '../src/platform/container.js';
import type { Db } from '../src/db/client.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-context-docs] Docker not available — skipping integration tests.');
}

/**
 * Agent <-> context-doc attachments (`agent_context_docs`, Work Item 8 of
 * docs/project-context-folder-plan.md). Mirrors `agents-skills.it.test.ts`'s
 * coverage shape for the structural precedent this table follows exactly:
 * checking a document creates/enables a row appended at the end of order
 * (AC-18); unchecking preserves the row + order, never deletes it (AC-19);
 * the bulk `POST` (full-list reorder, AC-20) is NOT interchangeable with the
 * `PATCH` toggle for "attach enabled" — a prior agent_skills test picked the
 * wrong one and silently got the wrong default (see
 * docs/project-context-folder-plan.md's "Relevant INSIGHTS.md Gotchas");
 * a path missing from the latest `context_documents` scan resolves
 * `document: null` (AC-22's backend half); cross-workspace agent id → 404
 * (AC-40).
 */
d('agent_context_docs links', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  async function makeAgent(repo: AgentsRepository, name: string, ws = workspaceId) {
    return repo.insert({
      workspaceId: ws,
      name,
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review the diff.',
    });
  }

  async function makeRepo(db: Db, fullName: string, ws = workspaceId) {
    const [owner, name] = fullName.split('/');
    const [row] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: owner!, name: name!, fullName })
      .returning();
    return row!;
  }

  async function makeDoc(
    db: Db,
    repoId: string,
    path: string,
    overrides: Partial<typeof t.contextDocuments.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(t.contextDocuments)
      .values({
        repoId,
        path,
        root: 'specs',
        sizeBytes: 100,
        contentHash: 'hash-1',
        chunkCount: null,
        indexStatus: 'disabled',
        lastIndexedAt: new Date(),
        ...overrides,
      })
      .returning();
    return row!;
  }

  it('PATCH attaches AND enables an unattached document in one call, appended at the end of order', async () => {
    const { db } = pg.handle;
    const repo = new AgentsRepository(db);
    const agent = await makeAgent(repo, 'Attach And Enable Doc');
    const r = await makeRepo(db, 'acme/context-docs-1');
    await makeDoc(db, r.id, 'specs/a.md');

    // Not attached yet.
    expect(await repo.linkedContextDocs(agent.id, r.id)).toHaveLength(0);

    await repo.setAgentContextDocEnabled(agent.id, r.id, 'specs/a.md', true);

    const links = await repo.linkedContextDocs(agent.id, r.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ path: 'specs/a.md', order: 0, enabled: true });
  });

  it('PATCH on an already-attached document toggles enabled without touching order (uncheck preserves the row)', async () => {
    const { db } = pg.handle;
    const repo = new AgentsRepository(db);
    const agent = await makeAgent(repo, 'Toggle Without Reorder Doc');
    const r = await makeRepo(db, 'acme/context-docs-2');

    await repo.setAgentContextDocEnabled(agent.id, r.id, 'specs/a.md', true); // order 0
    await repo.setAgentContextDocEnabled(agent.id, r.id, 'specs/b.md', true); // order 1

    // Uncheck a.md — row persists, keeps order 0, just enabled: false.
    await repo.setAgentContextDocEnabled(agent.id, r.id, 'specs/a.md', false);

    const links = await repo.linkedContextDocs(agent.id, r.id);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ path: 'specs/a.md', order: 0, enabled: false });
    expect(links[1]).toMatchObject({ path: 'specs/b.md', order: 1, enabled: true });

    // Re-check it — same row, same order, enabled flips back.
    await repo.setAgentContextDocEnabled(agent.id, r.id, 'specs/a.md', true);
    const relinked = await repo.linkedContextDocs(agent.id, r.id);
    expect(relinked[0]).toMatchObject({ path: 'specs/a.md', order: 0, enabled: true });
  });

  it(
    'REGRESSION: bulk POST reorder does NOT silently re-enable an unrelated currently-unchecked ' +
      'document — the exact agent_skills bug class this table must not repeat',
    async () => {
      const { db } = pg.handle;
      const repo = new AgentsRepository(db);
      const agent = await makeAgent(repo, 'Bulk Reorder Preserves Enabled');
      const r = await makeRepo(db, 'acme/context-docs-3');

      await repo.setAgentContextDocEnabled(agent.id, r.id, 'specs/enabled.md', true);
      await repo.setAgentContextDocEnabled(agent.id, r.id, 'specs/disabled.md', false);
      // never-attached.md was never attached before this bulk reorder.

      // A pure reorder (drag) submitted from the catalog list — includes the
      // previously-unattached path too, per the unified-list drag semantics.
      await repo.setAgentContextDocs(agent.id, r.id, [
        'specs/never-attached.md',
        'specs/disabled.md',
        'specs/enabled.md',
      ]);

      const links = await repo.linkedContextDocs(agent.id, r.id);
      const byPath = new Map(links.map((l) => [l.path, l]));

      // disabled.md stays disabled — a reorder-only bulk call must NOT flip
      // it on just because it appears in the reordered array.
      expect(byPath.get('specs/disabled.md')).toMatchObject({ order: 1, enabled: false });
      // enabled.md keeps its prior enabled: true.
      expect(byPath.get('specs/enabled.md')).toMatchObject({ order: 2, enabled: true });
      // never-attached.md, never attached before, defaults to false — bulk
      // POST alone does not enable it, only PATCH does.
      expect(byPath.get('specs/never-attached.md')).toMatchObject({ order: 0, enabled: false });
    },
  );

  it('bulk POST persists a new order for BOTH attached and unattached paths, and unlinks paths dropped from the list', async () => {
    const { db } = pg.handle;
    const repo = new AgentsRepository(db);
    const agent = await makeAgent(repo, 'Bulk Reorder Drops Unlisted');
    const r = await makeRepo(db, 'acme/context-docs-4');

    await repo.setAgentContextDocEnabled(agent.id, r.id, 'specs/a.md', true);
    await repo.setAgentContextDocEnabled(agent.id, r.id, 'specs/b.md', true);

    // b.md dropped from the new list entirely.
    await repo.setAgentContextDocs(agent.id, r.id, ['specs/a.md']);

    const links = await repo.linkedContextDocs(agent.id, r.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ path: 'specs/a.md', order: 0, enabled: true });
  });

  it('service.getContextDocLinks resolves document: null for a path missing from the latest context_documents scan', async () => {
    const { db } = pg.handle;
    const repo = new AgentsRepository(db);
    const agent = await makeAgent(repo, 'Missing Doc Resolution');
    const r = await makeRepo(db, 'acme/context-docs-5');
    await makeDoc(db, r.id, 'specs/present.md', { indexStatus: 'indexed', chunkCount: 3 });

    await repo.setAgentContextDocEnabled(agent.id, r.id, 'specs/present.md', true);
    await repo.setAgentContextDocEnabled(agent.id, r.id, 'specs/gone.md', true);

    const { RepoRepository } = await import('../src/modules/repos/repository.js');
    const { ContextDocsRepository } = await import('../src/modules/context-docs/repository.js');
    const service = new AgentsService({
      db,
      reposRepo: new RepoRepository(db),
      contextDocsRepo: new ContextDocsRepository(db),
    } as unknown as Container);

    const links = await service.getContextDocLinks(workspaceId, agent.id, r.id);
    expect(links).toBeDefined();
    const byPath = new Map(links!.map((l) => [l.path, l]));

    expect(byPath.get('specs/present.md')!.document).toMatchObject({
      path: 'specs/present.md',
      index_status: 'indexed',
      chunk_count: 3,
    });
    expect(byPath.get('specs/gone.md')!.document).toBeNull();
  });

  it('all 3 context-docs routes 404 for an agent id outside the workspace', async () => {
    const app = await makeApp();
    const { db } = pg.handle;
    const [otherWs] = await db
      .insert(t.workspaces)
      .values({ name: 'other-context-docs' })
      .returning();
    const repo = new AgentsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });
    const r = await makeRepo(db, 'acme/context-docs-6');

    const getRes = await app.inject({
      method: 'GET',
      url: `/agents/${foreign.id}/context-docs?repo_id=${r.id}`,
    });
    expect(getRes.statusCode).toBe(404);

    const postRes = await app.inject({
      method: 'POST',
      url: `/agents/${foreign.id}/context-docs?repo_id=${r.id}`,
      payload: { paths: ['specs/a.md'] },
    });
    expect(postRes.statusCode).toBe(404);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/agents/${foreign.id}/context-docs/${encodeURIComponent('specs/a.md')}?repo_id=${r.id}`,
      payload: { enabled: true },
    });
    expect(patchRes.statusCode).toBe(404);

    await app.close();
  });

  it('routes 404 for a repo id outside the workspace, even with a valid agent id', async () => {
    const app = await makeApp();
    const { db } = pg.handle;
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Foreign Repo Agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review.',
      },
    });
    const agentId = created.json().id as string;

    const [otherWs] = await db
      .insert(t.workspaces)
      .values({ name: 'other-repo-ws' })
      .returning();
    const foreignRepo = await makeRepo(db, 'acme/foreign-repo', otherWs!.id);

    const res = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}/context-docs?repo_id=${foreignRepo.id}`,
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('PATCH /agents/:id/context-docs/:path percent-decodes a path segment containing a slash', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Percent Decode Agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review.',
      },
    });
    const agentId = created.json().id as string;
    const r = await makeRepo(pg.handle.db, 'acme/context-docs-7');

    const encodedPath = encodeURIComponent('specs/nested/public-api.md');
    const patched = await app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}/context-docs/${encodedPath}?repo_id=${r.id}`,
      payload: { enabled: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toEqual([
      { path: 'specs/nested/public-api.md', order: 0, enabled: true, document: null },
    ]);

    await app.close();
  });

  it('rejects a non-boolean enabled body with 422', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Bad Body Context Doc Agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review.',
      },
    });
    const agentId = created.json().id as string;
    const r = await makeRepo(pg.handle.db, 'acme/context-docs-8');

    const res = await app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}/context-docs/${encodeURIComponent('specs/a.md')}?repo_id=${r.id}`,
      payload: { enabled: 'yes' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('rejects a missing repo_id query param with 422', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Missing Repo Query Agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review.',
      },
    });
    const agentId = created.json().id as string;

    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/context-docs` });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
