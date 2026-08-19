/**
 * Onboarding Generator — integration, real Postgres via testcontainers
 * (docs/onboarding-generator-plan.md Work Item 10). Covers the real upsert
 * lifecycle, real `stale` computation against a seeded `indexed_sha`
 * mismatch, real rate-limit 429, and real cross-workspace 404 — matches
 * spec §6.1/§6.2's Verify: clauses end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';
import type { ContainerOverrides } from '../src/platform/container.js';
import { ONBOARDING_SECTION_KINDS } from '../src/modules/onboarding/constants.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import type { Onboarding } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[onboarding] Docker not available — skipping integration tests.');
}

function fixtureTour(): Onboarding {
  return {
    sections: ONBOARDING_SECTION_KINDS.map((kind) => ({
      kind,
      title: `Title for ${kind}`,
      body: `Body for ${kind}`,
      diagram: kind === 'architecture' ? 'flowchart TD\nA-->B' : null,
      links: [],
    })),
  };
}

d('onboarding module', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-workspace' })
      .returning();
    otherWorkspaceId = otherWs!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** `nodeEnv: 'development'` (not 'test') so the global `@fastify/rate-limit`
   *  plugin actually registers (`app.ts:95-97` skips it entirely under
   *  'test', which every OTHER `.it.test.ts` in this repo relies on to hammer
   *  routes freely via `inject()`) — needed only by the 429 test below,
   *  which deliberately wants the real limiter engaged. `LOG_LEVEL: 'silent'`
   *  keeps this from becoming a noisy outlier in the test run's own logs. */
  function makeApp(opts: { llm?: MockLLMProvider; nodeEnv?: 'test' | 'development' } = {}) {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: opts.nodeEnv ?? 'test',
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);
    const overrides: ContainerOverrides = {};
    if (opts.llm) overrides.llm = { openrouter: opts.llm };
    return buildApp({ config, db: pg.handle.db, overrides });
  }

  async function makeRepo(fullName: string, ws: string = workspaceId) {
    const [owner, name] = fullName.split('/');
    const [row] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: owner!, name: name!, fullName, clonePath: `/clones/${name}` })
      .returning();
    return row!;
  }

  async function seedIndexState(repoId: string, lastIndexedSha: string) {
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId,
      lastIndexedSha,
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      filesIndexed: 123,
      filesSkipped: 0,
    });
  }

  it('GET returns tour:null with zero LLM calls for a never-generated repo, then Regenerate persists a tour; a second Regenerate replaces the row in place (never a second row)', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixtureTour() });
    const app = await makeApp({ llm });
    const repo = await makeRepo('acme/lifecycle');
    await seedIndexState(repo.id, 'sha-1');

    const getEmpty = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(getEmpty.statusCode).toBe(200);
    expect(getEmpty.json()).toMatchObject({ tour: null, stale: false });
    expect(llm.calls).toHaveLength(0);

    const regen1 = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/regenerate` });
    expect(regen1.statusCode).toBe(200);
    const body1 = regen1.json();
    expect(body1.tour.sections).toHaveLength(5);
    expect(body1.indexed_sha).toBe('sha-1');
    expect(body1.file_count).toBe(123);
    expect(body1.provider).toBe('openrouter');

    const getPopulated = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(getPopulated.json().tour.sections).toHaveLength(5);

    const regen2 = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/regenerate` });
    expect(regen2.statusCode).toBe(200);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(2);

    const rows = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repo.id));
    expect(rows).toHaveLength(1); // replaced in place, never a second row
  });

  it('stale reflects a real seeded indexed_sha mismatch against the repo-intel index state', async () => {
    const app = await makeApp();
    const repo = await makeRepo('acme/stale-check');
    await seedIndexState(repo.id, 'sha-old');
    await pg.handle.db.insert(t.onboarding).values({
      repoId: repo.id,
      json: fixtureTour(),
      indexedSha: 'sha-old',
      fileCount: 5,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      tokensIn: 100,
      tokensOut: 200,
    });

    const matching = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(matching.json().stale).toBe(false);

    await pg.handle.db
      .update(t.repoIndexState)
      .set({ lastIndexedSha: 'sha-new' })
      .where(eq(t.repoIndexState.repoId, repo.id));

    const mismatched = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(mismatched.json().stale).toBe(true);
    expect(mismatched.json().tour.sections).toHaveLength(5); // content still served unchanged
  });

  it('a repo id from another workspace 404s on both GET and Regenerate', async () => {
    const app = await makeApp();
    const repo = await makeRepo('acme/scoped', workspaceId);

    // Simulate a caller in a DIFFERENT workspace by seeding the repo under
    // `otherWorkspaceId` and requesting it via the default (`workspaceId`)
    // auth context `getContext` resolves to (LocalNoAuthProvider's single
    // default workspace) — mirrors context-docs.it.test.ts's own
    // cross-workspace fixture shape.
    const foreignRepo = await makeRepo('acme/foreign', otherWorkspaceId);

    const getRes = await app.inject({ method: 'GET', url: `/repos/${foreignRepo.id}/onboarding` });
    expect(getRes.statusCode).toBe(404);

    const postRes = await app.inject({ method: 'POST', url: `/repos/${foreignRepo.id}/onboarding/regenerate` });
    expect(postRes.statusCode).toBe(404);

    // Sanity: the SAME repo under the caller's own workspace is NOT 404.
    const okRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/onboarding` });
    expect(okRes.statusCode).toBe(200);
  });

  it('AC-31 — an 11th Regenerate within 60s from the same workspace returns 429 (real rate limiter)', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixtureTour() });
    const app = await makeApp({ llm, nodeEnv: 'development' });
    const repo = await makeRepo('acme/rate-limited');
    await seedIndexState(repo.id, 'sha-1');

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/onboarding/regenerate` });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
