import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Embedder } from '@devdigest/shared';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';
import type { Db } from '../src/db/client.js';
import type { ContainerOverrides } from '../src/platform/container.js';
import { MAX_INDEXABLE_BYTES } from '../src/modules/context-docs/service.js';
import { DEFAULT_CONTEXT_EXCLUDES } from '../src/modules/context-docs/reader.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context-docs] Docker not available — skipping integration tests.');
}

/** Deterministic embed() spy — never a real network call. */
class SpyEmbedder implements Embedder {
  readonly dims = 1536;
  calls: string[][] = [];
  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push(texts);
    return texts.map(() => new Array(1536).fill(0));
  }
}

/**
 * Project Context Folder — reader/reindex, search-root config, and browser
 * endpoints (`docs/project-context-folder-plan.md` Work Items 3, 4, 5, 6;
 * spec §6.1-6.4). Covers AC-1 through AC-16, AC-38, AC-40, AC-41.
 */
d('context-docs module', () => {
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

  function makeApp(opts: { embeddingsEnabled?: boolean; embedder?: Embedder } = {}) {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      EMBEDDINGS_ENABLED: opts.embeddingsEnabled ? 'true' : 'false',
    } as NodeJS.ProcessEnv);
    const overrides: ContainerOverrides = {
      git: new MockGitClient(),
      github: new MockGitHubClient(),
      // No real OPENAI_API_KEY anywhere — forces a clean ConfigError
      // ("misconfigured") when embeddings are on but no embedder override
      // is given, regardless of the host machine's real secrets file
      // (server/INSIGHTS.md 2026-08-09 gotcha).
      secrets: new MockSecretsProvider({}),
    };
    if (opts.embedder) overrides.embedder = opts.embedder;
    return buildApp({ config, db: pg.handle.db, overrides });
  }

  async function makeRepo(
    db: Db,
    fullName: string,
    opts: { ws?: string; clonePath?: string | null; contextSearchExcludes?: string[] | null } = {},
  ) {
    const [owner, name] = fullName.split('/');
    const [row] = await db
      .insert(t.repos)
      .values({
        workspaceId: opts.ws ?? workspaceId,
        owner: owner!,
        name: name!,
        fullName,
        clonePath: opts.clonePath ?? null,
        contextSearchExcludes: opts.contextSearchExcludes ?? null,
      })
      .returning();
    return row!;
  }

  async function makeFixtureClone(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'devdigest-context-docs-it-'));
    clonePaths.push(root);
    for (const [rel, content] of Object.entries(files)) {
      const full = join(root, ...rel.split('/'));
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, content);
    }
    return root;
  }

  it('reindex discovers markdown across specs/docs/insights with correct root, excludes node_modules', async () => {
    const app = await makeApp();
    const clonePath = await makeFixtureClone({
      'specs/a.md': '# A',
      'specs/b.md': '# B',
      'docs/c.md': '# C',
      'docs/d.md': '# D',
      'insights/e.md': '# E',
      'insights/f.md': '# F',
      'node_modules/pkg/README.md': '# should never appear',
    });
    const repo = await makeRepo(pg.handle.db, 'acme/discover', { clonePath });

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/context-docs/reindex` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.documents).toHaveLength(6);
    expect(body.file_count).toBe(6);
    const byPath = new Map(body.documents.map((doc: { path: string; root: string }) => [doc.path, doc.root]));
    expect(byPath.get('specs/a.md')).toBe('specs');
    expect(byPath.get('docs/c.md')).toBe('docs');
    expect(byPath.get('insights/e.md')).toBe('insights');
    expect(body.documents.map((doc: { path: string }) => doc.path)).not.toContain(
      'node_modules/pkg/README.md',
    );

    await app.close();
  });

  it(
    'AC-2: a rescan after a file is deleted removes only that context_documents row; ' +
      'a seeded agent_context_docs attachment referencing that path survives unchanged',
    async () => {
      const app = await makeApp();
      const { db } = pg.handle;
      const clonePath = await makeFixtureClone({ 'docs/keep.md': '# Keep', 'docs/gone.md': '# Gone' });
      const repo = await makeRepo(db, 'acme/deletion', { clonePath });

      await app.inject({ method: 'POST', url: `/repos/${repo.id}/context-docs/reindex` });

      const agentsRepo = new AgentsRepository(db);
      const agent = await agentsRepo.insert({
        workspaceId,
        name: 'Deletion Watcher',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'Review.',
      });
      await agentsRepo.setAgentContextDocEnabled(agent.id, repo.id, 'docs/gone.md', true);

      await rm(join(clonePath, 'docs', 'gone.md'));
      const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/context-docs/reindex` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.documents.map((doc: { path: string }) => doc.path)).toEqual(['docs/keep.md']);

      // The context_documents row for gone.md is gone...
      const [goneDoc] = await db
        .select()
        .from(t.contextDocuments)
        .where(and(eq(t.contextDocuments.repoId, repo.id), eq(t.contextDocuments.path, 'docs/gone.md')));
      expect(goneDoc).toBeUndefined();

      // ...but the attachment row survives, unchanged.
      const links = await agentsRepo.linkedContextDocs(agent.id, repo.id);
      const goneLink = links.find((l) => l.path === 'docs/gone.md');
      expect(goneLink).toMatchObject({ path: 'docs/gone.md', enabled: true });

      await app.close();
    },
  );

  it('AC-16: a repo with no clonePath returns a 200 not_indexed empty state on GET and reindex, never 500', async () => {
    const app = await makeApp();
    const repo = await makeRepo(pg.handle.db, 'acme/never-cloned', { clonePath: null });

    const getRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context-docs` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toMatchObject({ documents: [], index_status: 'not_indexed' });

    const reindexRes = await app.inject({ method: 'POST', url: `/repos/${repo.id}/context-docs/reindex` });
    expect(reindexRes.statusCode).toBe(200);
    expect(reindexRes.json()).toMatchObject({ documents: [], index_status: 'not_indexed' });

    await app.close();
  });

  describe('context-config', () => {
    it('AC-5: a fresh repo returns the literal default excludes', async () => {
      const app = await makeApp();
      const repo = await makeRepo(pg.handle.db, 'acme/config-default');
      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context-config` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ excludes: DEFAULT_CONTEXT_EXCLUDES });
      await app.close();
    });

    it('AC-6: PUT persists a custom exclude scoped to that repo only, taking effect on next reindex', async () => {
      const app = await makeApp();
      const clonePathA = await makeFixtureClone({ 'guides/only.md': '# Only', 'docs/ignored.md': '# Ignored' });
      const clonePathB = await makeFixtureClone({ 'docs/untouched.md': '# Untouched' });
      const repoA = await makeRepo(pg.handle.db, 'acme/config-scoped-a', { clonePath: clonePathA });
      const repoB = await makeRepo(pg.handle.db, 'acme/config-scoped-b', { clonePath: clonePathB });

      const putRes = await app.inject({
        method: 'PUT',
        url: `/repos/${repoA.id}/context-config`,
        payload: { excludes: ['docs/**/*.md'] },
      });
      expect(putRes.statusCode).toBe(200);
      expect(putRes.json()).toEqual({ excludes: ['docs/**/*.md'] });

      const reindexA = await app.inject({ method: 'POST', url: `/repos/${repoA.id}/context-docs/reindex` });
      expect(reindexA.json().documents.map((doc: { path: string }) => doc.path)).toEqual(['guides/only.md']);

      // repoB's own config/documents are unaffected.
      const configB = await app.inject({ method: 'GET', url: `/repos/${repoB.id}/context-config` });
      expect(configB.json()).toEqual({ excludes: DEFAULT_CONTEXT_EXCLUDES });
      const reindexB = await app.inject({ method: 'POST', url: `/repos/${repoB.id}/context-docs/reindex` });
      expect(reindexB.json().documents.map((doc: { path: string }) => doc.path)).toEqual(['docs/untouched.md']);

      await app.close();
    });

    it(
      'AC-6: null vs [] — getConfig() defaults when unconfigured, setConfig([]) persists ' +
        'verbatim (not defaults), and reindex only discovers AGENTS.md once excludes are []',
      async () => {
        const app = await makeApp();
        const clonePath = await makeFixtureClone({
          'AGENTS.md': '# Agent instructions',
          'docs/readme.md': '# Readme',
        });
        const repo = await makeRepo(pg.handle.db, 'acme/null-vs-empty', { clonePath });

        // Unconfigured (`contextSearchExcludes` is null) — getConfig() returns the default set.
        const configBefore = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context-config` });
        expect(configBefore.json()).toEqual({ excludes: DEFAULT_CONTEXT_EXCLUDES });

        // Reindex under that unconfigured default excludes AGENTS.md.
        const reindexUnconfigured = await app.inject({
          method: 'POST',
          url: `/repos/${repo.id}/context-docs/reindex`,
        });
        expect(
          reindexUnconfigured.json().documents.map((doc: { path: string }) => doc.path),
        ).toEqual(['docs/readme.md']);

        // Explicitly persist an empty array — must NOT collapse back to the defaults.
        const putRes = await app.inject({
          method: 'PUT',
          url: `/repos/${repo.id}/context-config`,
          payload: { excludes: [] },
        });
        expect(putRes.statusCode).toBe(200);
        expect(putRes.json()).toEqual({ excludes: [] });

        const configAfter = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context-config` });
        expect(configAfter.json()).toEqual({ excludes: [] });

        // With excludes == [], the same fixture's AGENTS.md is now discovered too.
        const reindexEmpty = await app.inject({
          method: 'POST',
          url: `/repos/${repo.id}/context-docs/reindex`,
        });
        const paths = reindexEmpty
          .json()
          .documents.map((doc: { path: string }) => doc.path)
          .sort();
        expect(paths).toEqual(['AGENTS.md', 'docs/readme.md']);

        await app.close();
      },
    );

    it('AC-7: PUT with a clonePath-escaping exclude pattern is no longer rejected (200)', async () => {
      const app = await makeApp();
      const repo = await makeRepo(pg.handle.db, 'acme/config-escape');

      const res = await app.inject({
        method: 'PUT',
        url: `/repos/${repo.id}/context-config`,
        payload: { excludes: ['../../etc/**/*.md'] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ excludes: ['../../etc/**/*.md'] });

      const config = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context-config` });
      expect(config.json()).toEqual({ excludes: ['../../etc/**/*.md'] });

      await app.close();
    });

    it('AC-7: PUT with a whitespace-only exclude pattern is rejected with 422', async () => {
      const app = await makeApp();
      const repo = await makeRepo(pg.handle.db, 'acme/config-whitespace');

      const res = await app.inject({
        method: 'PUT',
        url: `/repos/${repo.id}/context-config`,
        payload: { excludes: ['   '] },
      });
      expect(res.statusCode).toBe(422);

      await app.close();
    });

    it('AC-7: PUT with an empty-string exclude pattern is rejected with 422', async () => {
      const app = await makeApp();
      const repo = await makeRepo(pg.handle.db, 'acme/config-empty-string');

      const res = await app.inject({
        method: 'PUT',
        url: `/repos/${repo.id}/context-config`,
        payload: { excludes: [''] },
      });
      expect(res.statusCode).toBe(422);

      await app.close();
    });
  });

  describe('preview', () => {
    it('AC-14: returns raw content read-only; AC-16-adjacent: 404 for an undiscovered path', async () => {
      const app = await makeApp();
      const clonePath = await makeFixtureClone({ 'docs/readme.md': '# Hello\n\nBody text.' });
      const repo = await makeRepo(pg.handle.db, 'acme/preview', { clonePath });
      await app.inject({ method: 'POST', url: `/repos/${repo.id}/context-docs/reindex` });

      const ok = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context-docs/preview?path=${encodeURIComponent('docs/readme.md')}`,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ path: 'docs/readme.md', content: '# Hello\n\nBody text.' });

      const missing = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context-docs/preview?path=${encodeURIComponent('docs/never-discovered.md')}`,
      });
      expect(missing.statusCode).toBe(404);

      await app.close();
    });
  });

  describe('embeddings gating (AC-8, AC-9, AC-10, AC-11, AC-12, AC-38)', () => {
    it('AC-9: EMBEDDINGS_ENABLED=false completes discovery; chunk_count null, index_status disabled', async () => {
      const app = await makeApp({ embeddingsEnabled: false });
      const clonePath = await makeFixtureClone({ 'docs/a.md': '# A\nbody' });
      const repo = await makeRepo(pg.handle.db, 'acme/embed-disabled', { clonePath });

      const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/context-docs/reindex` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.index_status).toBe('disabled');
      expect(body.total_chunk_count).toBeNull();
      expect(body.documents[0]).toMatchObject({ chunk_count: null, index_status: 'disabled' });

      await app.close();
    });

    it('AC-10: EMBEDDINGS_ENABLED=true with no key configured degrades to misconfigured (not disabled)', async () => {
      const app = await makeApp({ embeddingsEnabled: true }); // no embedder override, MockSecretsProvider({})
      const clonePath = await makeFixtureClone({ 'docs/a.md': '# A\nbody' });
      const repo = await makeRepo(pg.handle.db, 'acme/embed-misconfigured', { clonePath });

      const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/context-docs/reindex` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.index_status).toBe('misconfigured');
      expect(body.total_chunk_count).toBeNull();
      expect(body.documents[0]).toMatchObject({ chunk_count: null, index_status: 'misconfigured' });

      await app.close();
    });

    it('AC-8: reindex with a mocked Embedder inserts code_chunks and reflects chunk_count', async () => {
      const embedder = new SpyEmbedder();
      const app = await makeApp({ embeddingsEnabled: true, embedder });
      const clonePath = await makeFixtureClone({
        'docs/a.md': '# Heading One\nSome body text.\n\n## Heading Two\nMore body text.',
      });
      const repo = await makeRepo(pg.handle.db, 'acme/embed-ready', { clonePath });

      const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/context-docs/reindex` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.index_status).toBe('indexed');
      expect(body.documents[0]).toMatchObject({ index_status: 'indexed' });
      expect(body.documents[0].chunk_count).toBeGreaterThan(0);
      expect(embedder.calls.length).toBeGreaterThan(0);

      const chunkRows = await pg.handle.db.select().from(t.codeChunks).where(eq(t.codeChunks.repoId, repo.id));
      expect(chunkRows.length).toBe(body.documents[0].chunk_count);
      expect(chunkRows[0]!.source).toBe('docs');

      await app.close();
    });

    it('AC-11: a document over 1 MB is discovered but not chunked (too_large_to_index); exactly-1MB indexes normally', async () => {
      const embedder = new SpyEmbedder();
      const app = await makeApp({ embeddingsEnabled: true, embedder });
      const oversized = 'x'.repeat(MAX_INDEXABLE_BYTES + 1);
      const exact = 'x'.repeat(MAX_INDEXABLE_BYTES);
      const clonePath = await makeFixtureClone({
        'docs/oversized.md': oversized,
        'docs/exact.md': exact,
      });
      const repo = await makeRepo(pg.handle.db, 'acme/embed-size-cap', { clonePath });

      const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/context-docs/reindex` });
      expect(res.statusCode).toBe(200);
      const byPath = new Map(
        res.json().documents.map((doc: { path: string; chunk_count: number | null; index_status: string }) => [
          doc.path,
          doc,
        ]),
      );
      expect(byPath.get('docs/oversized.md')).toMatchObject({
        chunk_count: null,
        index_status: 'too_large_to_index',
      });
      const exactDoc = byPath.get('docs/exact.md') as { chunk_count: number | null; index_status: string };
      expect(exactDoc.index_status).toBe('indexed');
      expect(exactDoc.chunk_count).toBeGreaterThan(0);

      await app.close();
    });

    it('AC-38: a second reindex with zero file changes issues zero Embedder.embed() calls', async () => {
      const embedder = new SpyEmbedder();
      const app = await makeApp({ embeddingsEnabled: true, embedder });
      const clonePath = await makeFixtureClone({ 'docs/a.md': '# A\nbody text here' });
      const repo = await makeRepo(pg.handle.db, 'acme/embed-shortcircuit', { clonePath });

      await app.inject({ method: 'POST', url: `/repos/${repo.id}/context-docs/reindex` });
      const firstCallCount = embedder.calls.length;
      expect(firstCallCount).toBeGreaterThan(0);

      const second = await app.inject({ method: 'POST', url: `/repos/${repo.id}/context-docs/reindex` });
      expect(second.statusCode).toBe(200);
      expect(second.json().documents[0]).toMatchObject({ index_status: 'indexed' });
      expect(embedder.calls.length).toBe(firstCallCount); // zero NEW calls

      await app.close();
    });

    it('AC-12: GET (no reindex) never invokes Embedder.embed(), even though it resolves gate status', async () => {
      const embedder = new SpyEmbedder();
      const app = await makeApp({ embeddingsEnabled: true, embedder });
      const clonePath = await makeFixtureClone({ 'docs/a.md': '# A\nbody' });
      const repo = await makeRepo(pg.handle.db, 'acme/embed-get-only', { clonePath });

      const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context-docs` });
      expect(res.statusCode).toBe(200);
      expect(embedder.calls.length).toBe(0);

      await app.close();
    });
  });

  it('AC-13/AC-15: used_by_agents/used_by_skills reflect attachments, and coverage_percent reads 25 for 3 of 12', async () => {
    const app = await makeApp();
    const { db } = pg.handle;
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) files[`docs/doc-${i}.md`] = `# Doc ${i}`;
    const clonePath = await makeFixtureClone(files);
    const repo = await makeRepo(db, 'acme/coverage', { clonePath });
    await app.inject({ method: 'POST', url: `/repos/${repo.id}/context-docs/reindex` });

    const agentsRepo = new AgentsRepository(db);
    const skillsRepo = new SkillsRepository(db);
    const agent = await agentsRepo.insert({
      workspaceId,
      name: 'Coverage Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review.',
    });
    const skill = await skillsRepo.insert({
      workspaceId,
      name: 'coverage-skill',
      description: '',
      type: 'custom',
      source: 'manual',
      body: '# skill',
    });

    await agentsRepo.setAgentContextDocEnabled(agent.id, repo.id, 'docs/doc-0.md', true);
    await agentsRepo.setAgentContextDocEnabled(agent.id, repo.id, 'docs/doc-1.md', true);
    await skillsRepo.setSkillContextDocEnabled(skill.id, repo.id, 'docs/doc-2.md', true);

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context-docs` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.coverage_percent).toBe(25);

    const doc0 = body.documents.find((d: { path: string }) => d.path === 'docs/doc-0.md');
    expect(doc0.used_by_agents).toBe(1);
    expect(doc0.used_by_skills).toBe(0);
    const doc2 = body.documents.find((d: { path: string }) => d.path === 'docs/doc-2.md');
    expect(doc2.used_by_skills).toBe(1);

    await app.close();
  });

  it('AC-40: a repoId from another workspace 404s on every new route', async () => {
    const app = await makeApp();
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-context-docs' }).returning();
    const clonePath = await makeFixtureClone({ 'docs/a.md': '# A' });
    const foreign = await makeRepo(db, 'foreign/repo', { ws: otherWs!.id, clonePath });

    const getDocs = await app.inject({ method: 'GET', url: `/repos/${foreign.id}/context-docs` });
    expect(getDocs.statusCode).toBe(404);

    const reindex = await app.inject({ method: 'POST', url: `/repos/${foreign.id}/context-docs/reindex` });
    expect(reindex.statusCode).toBe(404);

    const preview = await app.inject({
      method: 'GET',
      url: `/repos/${foreign.id}/context-docs/preview?path=docs/a.md`,
    });
    expect(preview.statusCode).toBe(404);

    const getConfig = await app.inject({ method: 'GET', url: `/repos/${foreign.id}/context-config` });
    expect(getConfig.statusCode).toBe(404);

    const putConfig = await app.inject({
      method: 'PUT',
      url: `/repos/${foreign.id}/context-config`,
      payload: { excludes: ['docs/**/*.md'] },
    });
    expect(putConfig.statusCode).toBe(404);

    await app.close();
  });
});
