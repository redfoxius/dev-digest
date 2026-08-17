/**
 * `diff-loader.ts`'s three self-heal layers (docs/pr-diff-reindex-plan.md,
 * Work Item 7) — unit, no Docker. Constructs a real `Container` with
 * `ContainerOverrides` (onion-architecture skill's Testability section)
 * instead of hitting a real Postgres/GitHub/git clone.
 */
import { describe, it, expect } from 'vitest';
import type { PrDetail } from '@devdigest/shared';
import type { Db } from '../src/db/client.js';
import type { PullRow } from '../src/db/rows.js';
import * as schema from '../src/db/schema.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import type { PullsSync } from '../src/modules/pulls/service.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import { loadDiff } from '../src/modules/reviews/diff-loader.js';
import { DiffUnavailableError } from '../src/platform/errors.js';

const config = () => loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// `container.db` is never actually queried by any path these tests exercise
// (Layer 1 only touches `container.git`; Layer 2 either goes through a
// hand-written fake `PullsSync` or fails before any DB write — see each
// test) — a bare object stands in for the real Drizzle client.
const fakeDb = {} as unknown as Db;

const repoRow = { owner: 'acme', name: 'widgets' } as unknown as typeof schema.repos.$inferSelect;
const pull = { id: 'pr-1', number: 42, base: 'main', headSha: 'sha1' } as unknown as PullRow;

const PATCH =
  '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';

/** A `ReviewRepository`-shaped fake exposing only what `diffFromPrFiles()`
 *  (Layer 2/3's synthetic-diff reconstruction) reads. */
function fakeReviewRepo(
  files: { path: string; additions: number; deletions: number; patch: string | null }[],
): ReviewRepository {
  return { getPrFiles: async () => files } as unknown as ReviewRepository;
}

/** Hand-written fake `PullsSync` — isolates diff-loader.ts's own Layer 2
 *  branching from `PullsSyncService`'s internals (which would need a real
 *  Postgres to actually persist a refresh). */
class FakePullsSync implements PullsSync {
  public calls: { repo: unknown; pull: unknown }[] = [];
  constructor(private detail: PrDetail) {}
  async refreshFromGitHub(repo: unknown, pullRow: unknown): Promise<PrDetail> {
    this.calls.push({ repo, pull: pullRow });
    return this.detail;
  }
}

function fixtureDetail(): PrDetail {
  return {
    number: 42,
    title: 'Add rate limiting',
    author: 'marisa.koch',
    branch: 'feat/rl',
    base: 'main',
    head_sha: 'sha1',
    additions: 4,
    deletions: 0,
    files_count: 1,
    status: 'open',
    body: null,
    files: [{ path: 'src/config.ts', additions: 4, deletions: 0, patch: PATCH }],
    commits: [],
    linked_issue: null,
  };
}

describe('diff-loader.ts — the three self-heal layers (docs/pr-diff-reindex-plan.md)', () => {
  it('Layer 1 succeeds: git diff() returns files after the active fetchPullHead reindex', async () => {
    const git = new MockGitClient(); // default diff fixture: 1 file
    const container = new Container(config(), fakeDb, { git });

    const diff = await loadDiff(container, fakeReviewRepo([]), 'ws-1', pull, repoRow);

    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts']);
    expect(git.fetchPullHeadCalls).toEqual([{ repo: { owner: 'acme', name: 'widgets' }, n: 42 }]);
  });

  it('Layer 1 fails (diffThrows), Layer 2 succeeds via container.pullsSync.refreshFromGitHub', async () => {
    const git = new MockGitClient({ diffThrows: true });
    const fakePullsSync = new FakePullsSync(fixtureDetail());
    const container = new Container(config(), fakeDb, { git, pullsSync: fakePullsSync });
    const repo = fakeReviewRepo([{ path: 'src/config.ts', additions: 4, deletions: 0, patch: PATCH }]);

    const diff = await loadDiff(container, repo, 'ws-1', pull, repoRow);

    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts']);
    expect(fakePullsSync.calls).toHaveLength(1);
  });

  it('Layer 1 and Layer 2 both fail/empty: loadDiff() rejects with DiffUnavailableError', async () => {
    const git = new MockGitClient({ diffThrows: true });
    // No `github` override + a secrets provider with no GITHUB_TOKEN forces
    // container.github() (called inside the real PullsSyncService, since
    // `pullsSync` is NOT overridden here) to throw ConfigError before any DB
    // write is attempted — Layer 2's best-effort catch swallows it, same as
    // an offline/no-token GitHub refresh in production.
    const container = new Container(config(), fakeDb, { git, secrets: new MockSecretsProvider({}) });

    await expect(loadDiff(container, fakeReviewRepo([]), 'ws-1', pull, repoRow)).rejects.toThrow(
      DiffUnavailableError,
    );
  });
});
