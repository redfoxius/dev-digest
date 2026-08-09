/**
 * Phase 7.3 (docs/go-language-support-plan.md) — proves the real DB-backed
 * wiring for `getConventionSamplesStratified`: it reads `repo_index_state.
 * languages` and `file_rank` for real, and correctly hands them to the pure
 * `stratifyByLanguage` (already covered hermetically in
 * `repo-intel-sample.test.ts`, which pins the reservation math itself).
 *
 * Ranks are seeded directly into `file_rank` rather than produced by a real
 * `runFullIndex` + dependency-cruiser pass over a synthetic tmpdir fixture —
 * `DepCruiseGraph.buildEdges` (server/src/adapters/depgraph/index.ts)
 * silently returns zero edges for a `os.tmpdir()`-rooted fixture on macOS,
 * where `/var` (and `/tmp`) are symlinks to `/private/var` (`/private/tmp`):
 * dependency-cruiser's resolver realpath's the RESOLVED side of an import
 * but not the un-realpath'd entry-file paths passed in, so `toRel(root,
 * dep.resolved)` produces a long `../../private/...` escape that never
 * matches `fileSet`, and every edge is dropped as "not a local file" with
 * no error surfaced. That's a real, pre-existing gap in the TS depgraph
 * adapter (unrelated to Phase 7 / this module — worth a standalone fix,
 * not folded in here), not a fixture mistake; direct row seeding sidesteps
 * it entirely and keeps this test scoped to what Phase 7.3 actually
 * changed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('getConventionSamplesStratified — real DB-backed wiring (Testcontainers pg)', () => {
  let pg: PgFixture;
  let repoId: string;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'mixed-conventions',
        fullName: 'acme/mixed-conventions',
        clonePath: '/tmp/does-not-need-to-exist-for-this-test',
      })
      .returning();
    repoId = repo!.id;

    await pg.handle.db.insert(t.repoIndexState).values({
      repoId,
      lastIndexedSha: 'deadbeef',
      indexerVersion: 1,
      status: 'full',
      filesIndexed: 13,
      filesSkipped: 0,
      languages: ['typescript', 'go'],
    });

    // 12 TS files ranked strictly above the single Go file — the exact
    // crowd-out an unstratified top-12 would produce.
    const rows = [
      { filePath: 'main.go', pagerank: 0.01, rank: 0.01 },
      ...Array.from({ length: 12 }, (_, i) => ({
        filePath: `src/leaf${i}.ts`,
        pagerank: 0.1 - i * 0.001,
        rank: 0.1 - i * 0.001,
      })),
    ];
    await pg.handle.db.insert(t.fileRank).values(
      rows.map((r) => ({ repoId, filePath: r.filePath, pagerank: r.pagerank, hotness: 0, rank: r.rank, percentile: 0 })),
    );
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('unstratified getTopFilesByRank excludes the Go file', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });
    const plain = await app.container.repoIntel.getTopFilesByRank(repoId, 12);
    expect(plain).not.toContain('main.go');
    expect(plain.length).toBe(12);
    await app.close();
  });

  it('getConventionSamplesStratified includes the Go file via the real repoIntel.getIndexState + getRankedPaths wiring', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });
    const stratified = await app.container.repoIntel.getConventionSamplesStratified(repoId, 12);
    expect(stratified).toContain('main.go');
    expect(stratified.some((p) => p.endsWith('.ts'))).toBe(true);
    expect(stratified.length).toBe(12);
    await app.close();
  });

  it('degrades to plain getTopFilesByRank when only one language is present', async () => {
    const [singleLangRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'single-lang',
        fullName: 'acme/single-lang',
        clonePath: '/tmp/does-not-need-to-exist-for-this-test',
      })
      .returning();
    const singleRepoId = singleLangRepo!.id;
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId: singleRepoId,
      lastIndexedSha: 'deadbeef',
      indexerVersion: 1,
      status: 'full',
      filesIndexed: 1,
      filesSkipped: 0,
      languages: ['typescript'],
    });
    await pg.handle.db
      .insert(t.fileRank)
      .values({ repoId: singleRepoId, filePath: 'a.ts', pagerank: 0.5, hotness: 0, rank: 0.5, percentile: 100 });

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });
    const plain = await app.container.repoIntel.getTopFilesByRank(singleRepoId, 5);
    const stratified = await app.container.repoIntel.getConventionSamplesStratified(singleRepoId, 5);
    expect(stratified).toEqual(plain);
    await app.close();
  });
});
