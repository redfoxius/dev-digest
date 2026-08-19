import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';
import { SkillsService } from '../src/modules/skills/service.js';
import { Container } from '../src/platform/container.js';
import type { Db } from '../src/db/client.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills-context-docs] Docker not available — skipping integration tests.');
}

/**
 * Skill <-> context-doc attachments (`skill_context_docs`), the API the
 * Skill Editor's "Project context to use" Context tab relies on.
 * Docs/project-context-folder-plan.md Work Item 9 — identical shape to
 * Work Item 8's `agent_context_docs` (`agents-skills.it.test.ts` is the
 * structural precedent this file mirrors).
 *
 * Covers: `skillContextDocs` surfaces each link's `enabled`, ordered;
 * `setSkillContextDocEnabled` attach+enable in one call and toggle-without-
 * detach; `setSkillContextDocs` (bulk reorder) preserves unrelated paths'
 * `enabled` state across a pure reorder — the explicit regression test for
 * the same bug class documented in `server/INSIGHTS.md`'s `agent_skills`
 * entry (a reorder must never silently re-enable an unrelated,
 * currently-unchecked row); a path missing from the latest
 * `context_documents` scan resolves `document: null`; every new route
 * 404s for a skill id outside the workspace.
 */
d('skill_context_docs links', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'context-docs-fixture', fullName: 'acme/context-docs-fixture' })
      .returning();
    repoId = repo!.id;
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

  async function makeSkill(repo: SkillsRepository, name: string) {
    return repo.insert({
      workspaceId,
      name,
      type: 'custom',
      source: 'manual',
      body: `# ${name}`,
    });
  }

  /** Insert a discovered `context_documents` row directly (bypasses the
   *  reader/reindex service — out of scope for this module). */
  async function makeContextDocument(db: Db, path: string) {
    const [row] = await db
      .insert(t.contextDocuments)
      .values({
        repoId,
        path,
        root: 'specs',
        sizeBytes: 128,
        contentHash: 'hash-' + path,
        indexStatus: 'disabled',
        lastIndexedAt: new Date(),
      })
      .returning();
    return row!;
  }

  it('skillContextDocs returns each link\'s enabled, ordered ascending by order', async () => {
    const { db } = pg.handle;
    const repo = new SkillsRepository(db);
    const skill = await makeSkill(repo, 'Linked Docs Order');

    await repo.setSkillContextDocEnabled(skill.id, repoId, 'specs/a.md', true);
    await repo.setSkillContextDocEnabled(skill.id, repoId, 'specs/b.md', false);

    const links = await repo.skillContextDocs(skill.id, repoId);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ path: 'specs/a.md', order: 0, enabled: true });
    expect(links[1]).toMatchObject({ path: 'specs/b.md', order: 1, enabled: false });
  });

  it('setSkillContextDocEnabled attaches AND enables an unattached path in one call', async () => {
    const { db } = pg.handle;
    const repo = new SkillsRepository(db);
    const skill = await makeSkill(repo, 'Attach And Enable');

    expect(await repo.skillContextDocs(skill.id, repoId)).toHaveLength(0);

    await repo.setSkillContextDocEnabled(skill.id, repoId, 'docs/new.md', true);

    const links = await repo.skillContextDocs(skill.id, repoId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ path: 'docs/new.md', order: 0, enabled: true });
  });

  it('setSkillContextDocEnabled on an already-attached path flips enabled without touching order', async () => {
    const { db } = pg.handle;
    const repo = new SkillsRepository(db);
    const skill = await makeSkill(repo, 'Toggle Without Reorder');

    await repo.setSkillContextDocEnabled(skill.id, repoId, 'specs/first.md', true); // order 0
    await repo.setSkillContextDocEnabled(skill.id, repoId, 'specs/second.md', true); // order 1

    // Uncheck the first — row persists, keeps order 0, just enabled: false.
    await repo.setSkillContextDocEnabled(skill.id, repoId, 'specs/first.md', false);

    const links = await repo.skillContextDocs(skill.id, repoId);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ path: 'specs/first.md', order: 0, enabled: false });
    expect(links[1]).toMatchObject({ path: 'specs/second.md', order: 1, enabled: true });

    // Re-check it — same row, same order, enabled flips back.
    await repo.setSkillContextDocEnabled(skill.id, repoId, 'specs/first.md', true);
    const relinked = await repo.skillContextDocs(skill.id, repoId);
    expect(relinked[0]).toMatchObject({ path: 'specs/first.md', order: 0, enabled: true });
  });

  it(
    'REGRESSION: setSkillContextDocs (bulk reorder) does NOT silently re-enable an ' +
      'unrelated currently-unchecked path — same bug class as the agent_skills ' +
      'INSIGHTS.md entry (server/INSIGHTS.md, "not interchangeable for attach a skill enabled")',
    async () => {
      const { db } = pg.handle;
      const repo = new SkillsRepository(db);
      const skill = await makeSkill(repo, 'Reorder Preserves Enabled');

      await repo.setSkillContextDocEnabled(skill.id, repoId, 'specs/a-enabled.md', true);
      await repo.setSkillContextDocEnabled(skill.id, repoId, 'specs/b-disabled.md', false);
      // c-never-attached.md was never attached before this reorder.

      // A pure reorder (bulk POST) submitted from the Context tab's drag — includes
      // the previously-unattached path too, per the full-list drag semantics.
      await repo.setSkillContextDocs(skill.id, repoId, [
        'docs/c-never-attached.md',
        'specs/b-disabled.md',
        'specs/a-enabled.md',
      ]);

      const links = await repo.skillContextDocs(skill.id, repoId);
      const byPath = new Map(links.map((l) => [l.path, l]));

      // b-disabled MUST stay disabled — a reorder-only bulk POST must NOT flip it
      // on just because it appears in the reordered array.
      expect(byPath.get('specs/b-disabled.md')).toMatchObject({ order: 1, enabled: false });
      // a-enabled keeps its prior enabled: true.
      expect(byPath.get('specs/a-enabled.md')).toMatchObject({ order: 2, enabled: true });
      // c-never-attached, never attached before, defaults to false — attaching via
      // the bulk reorder alone does not enable it (only PATCH/setSkillContextDocEnabled does).
      expect(byPath.get('docs/c-never-attached.md')).toMatchObject({ order: 0, enabled: false });
    },
  );

  it('a path missing from the latest context_documents scan resolves document: null', async () => {
    const { db } = pg.handle;
    const repo = new SkillsRepository(db);
    const skill = await makeSkill(repo, 'Missing Doc');

    await repo.setSkillContextDocEnabled(skill.id, repoId, 'specs/never-scanned.md', true);

    const service = new SkillsService(makeRealContainer(db));
    const links = await service.contextDocLinks(workspaceId, skill.id, repoId);
    expect(links).toHaveLength(1);
    expect(links![0]).toMatchObject({ path: 'specs/never-scanned.md', enabled: true, document: null });
  });

  it('a discovered path resolves its document field with used_by counts', async () => {
    const { db } = pg.handle;
    const repo = new SkillsRepository(db);
    const skill = await makeSkill(repo, 'Discovered Doc');
    const doc = await makeContextDocument(db, 'specs/discovered.md');

    await repo.setSkillContextDocEnabled(skill.id, repoId, doc.path, true);

    const service = new SkillsService(makeRealContainer(db));
    const links = await service.contextDocLinks(workspaceId, skill.id, repoId);
    expect(links).toHaveLength(1);
    expect(links![0]!.document).toMatchObject({
      id: doc.id,
      path: 'specs/discovered.md',
      root: 'specs',
      used_by_agents: 0,
      used_by_skills: 1,
    });
  });

  it('GET/POST/PATCH /skills/:id/context-docs round-trip through the routes', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: 'Route Context Docs', type: 'custom', body: '# body' },
    });
    const skillId = created.json().id as string;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/skills/${skillId}/context-docs/${encodeURIComponent('specs/route-doc.md')}?repo_id=${repoId}`,
      payload: { enabled: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toEqual([
      { path: 'specs/route-doc.md', order: 0, enabled: true, document: null },
    ]);

    const got = await app.inject({ method: 'GET', url: `/skills/${skillId}/context-docs?repo_id=${repoId}` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual([
      { path: 'specs/route-doc.md', order: 0, enabled: true, document: null },
    ]);

    const reordered = await app.inject({
      method: 'POST',
      url: `/skills/${skillId}/context-docs?repo_id=${repoId}`,
      payload: { paths: ['docs/second.md', 'specs/route-doc.md'] },
    });
    expect(reordered.statusCode).toBe(200);
    const byPath = new Map((reordered.json() as { path: string; order: number; enabled: boolean }[]).map((l) => [l.path, l]));
    // The bulk POST reorder must NOT re-enable/attach docs/second.md as enabled.
    expect(byPath.get('docs/second.md')).toMatchObject({ order: 0, enabled: false });
    expect(byPath.get('specs/route-doc.md')).toMatchObject({ order: 1, enabled: true });

    await app.close();
  });

  it('GET/POST/PATCH /skills/:id/context-docs all 404 for a skill outside the workspace', async () => {
    const app = await makeApp();
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-context-docs' }).returning();
    const repo = new SkillsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign Skill',
      type: 'custom',
      source: 'manual',
      body: '# x',
    });

    const getRes = await app.inject({
      method: 'GET',
      url: `/skills/${foreign.id}/context-docs?repo_id=${repoId}`,
    });
    expect(getRes.statusCode).toBe(404);

    const postRes = await app.inject({
      method: 'POST',
      url: `/skills/${foreign.id}/context-docs?repo_id=${repoId}`,
      payload: { paths: ['specs/x.md'] },
    });
    expect(postRes.statusCode).toBe(404);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/skills/${foreign.id}/context-docs/${encodeURIComponent('specs/x.md')}?repo_id=${repoId}`,
      payload: { enabled: true },
    });
    expect(patchRes.statusCode).toBe(404);

    await app.close();
  });

  it('rejects a non-boolean enabled body with 422', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: 'Bad Body Skill', type: 'custom', body: '# x' },
    });
    const skillId = created.json().id as string;

    const res = await app.inject({
      method: 'PATCH',
      url: `/skills/${skillId}/context-docs/${encodeURIComponent('specs/x.md')}?repo_id=${repoId}`,
      payload: { enabled: 'yes' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('rejects a missing repo_id query param with 422', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: 'No Repo Id', type: 'custom', body: '# x' },
    });
    const skillId = created.json().id as string;

    const res = await app.inject({ method: 'GET', url: `/skills/${skillId}/context-docs` });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  /** A real `Container` (not a hand-rolled `{ db } as unknown as Container`
   *  stub, unlike `AgentsService`'s existing integration tests) — this
   *  module's `contextDocLinks`/`setContextDocs`/`setContextDocEnabled` all
   *  call `container.reposRepo.getById` for the AC-40 repo-scoping check, so
   *  a partial stub wouldn't resolve it. */
  function makeRealContainer(db: Db): Container {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return new Container(config, db);
  }
});
