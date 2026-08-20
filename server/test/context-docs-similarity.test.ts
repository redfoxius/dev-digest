import { describe, it, expect } from 'vitest';
import type { Db } from '../src/db/client.js';
import type { Embedder } from '@devdigest/shared';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { ContextDocsService } from '../src/modules/context-docs/service.js';
import { rankBySimilarity, type EmbeddedChunk } from '../src/modules/context-docs/similarity.js';

/**
 * `context-docs` top-K cosine-similarity search — unit coverage, no Docker
 * (`specs/cross-cutting/pr-why-risk-brief/plan.md` Work Item 3, spec
 * §6.2a/AC-29). Covers the pure ranking algorithm in isolation, the
 * mandatory `source: 'code'` exclusion (defense-in-depth — enforced both by
 * the repository's SQL `WHERE` and, provable here without Postgres, by a
 * JS-level filter over rows a fake `Db` hands back), and the
 * `embedResolution.status !== 'ready'` degrade path.
 */

const config = (opts: { embeddingsEnabled?: boolean } = {}) =>
  loadConfig({
    NODE_ENV: 'test',
    EMBEDDINGS_ENABLED: opts.embeddingsEnabled ? 'true' : 'false',
  } as NodeJS.ProcessEnv);

const REPO_ID = 'repo-1';

// ---- fake Db (queue-based select; mirrors test/onboarding.test.ts's makeFakeDb) ----
function makeFakeDb(selectQueue: unknown[][]): Db {
  let i = 0;
  function selectChain() {
    const chain = {
      from() {
        return chain;
      },
      where() {
        return chain;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        try {
          if (i >= selectQueue.length) {
            throw new Error(`makeFakeDb: no queued select result for call #${i} (queue has ${selectQueue.length})`);
          }
          resolve(selectQueue[i++]);
        } catch (err) {
          if (reject) reject(err);
          else throw err;
        }
      },
    };
    return chain;
  }
  return { select: () => selectChain() } as unknown as Db;
}

/** Deterministic embed() spy — never a real network call. */
class SpyEmbedder implements Embedder {
  readonly dims = 2;
  calls: string[][] = [];
  constructor(private embedding: number[] = [1, 0]) {}
  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push(texts);
    return texts.map(() => this.embedding);
  }
}

describe('rankBySimilarity (AC-29) — pure, no DB', () => {
  it('ranks chunks by descending cosine similarity and slices to k', () => {
    const query = [1, 0];
    const chunks: EmbeddedChunk[] = [
      { id: 'a', path: 'a.md', content: 'a', embedding: [1, 0] }, // score 1 (exact match)
      { id: 'b', path: 'b.md', content: 'b', embedding: [0, 1] }, // score 0 (orthogonal)
      { id: 'c', path: 'c.md', content: 'c', embedding: [0.9, 0.1] }, // score ~0.994
    ];

    const result = rankBySimilarity(query, chunks, 2);

    expect(result.map((r) => r.id)).toEqual(['a', 'c']);
    expect(result[0]!.score).toBeCloseTo(1, 5);
    expect(result[1]!.score).toBeGreaterThan(0);
    expect(result[1]!.score).toBeLessThan(1);
  });

  it('slices to k even when more chunks are given than requested', () => {
    const chunks: EmbeddedChunk[] = [
      { id: 'a', path: 'a.md', content: 'a', embedding: [1, 0] },
      { id: 'b', path: 'b.md', content: 'b', embedding: [1, 0] },
      { id: 'c', path: 'c.md', content: 'c', embedding: [1, 0] },
    ];
    expect(rankBySimilarity([1, 0], chunks, 1)).toHaveLength(1);
  });

  it('scores a zero-magnitude embedding as 0 rather than throwing (defensive)', () => {
    const result = rankBySimilarity(
      [1, 0],
      [{ id: 'z', path: 'z.md', content: 'z', embedding: [0, 0] }],
      1,
    );
    expect(result[0]!.score).toBe(0);
  });
});

describe('ContextDocsService.search (AC-29) — source filter', () => {
  it('excludes a source: "code" chunk even though its embedding would rank highest', async () => {
    // Simulates the worst case — a fake DB queue that (as if the SQL WHERE
    // had been weakened/removed) still hands back a `source: 'code'` row
    // alongside legitimate docs/spec chunks. Proves the repository's
    // defense-in-depth JS-level filter (not just the unverifiable-without-
    // Postgres SQL WHERE) keeps it out of the ranked result.
    const rows = [
      { id: 'code-1', path: 'src/index.ts', content: 'raw source code', embedding: [1, 0], source: 'code' },
      { id: 'docs-1', path: 'docs/a.md', content: 'doc a', embedding: [0.9, 0.1], source: 'docs' },
      { id: 'spec-1', path: 'specs/b.md', content: 'spec b', embedding: [0, 1], source: 'spec' },
    ];
    const db = makeFakeDb([rows]);
    const embedder = new SpyEmbedder([1, 0]);
    const container = new Container(config({ embeddingsEnabled: true }), db, { embedder });
    const service = new ContextDocsService(container);

    const results = await service.search(REPO_ID, 'query text', 2);

    expect(results.map((r) => r.id)).not.toContain('code-1');
    expect(results.map((r) => r.id)).toEqual(['docs-1', 'spec-1']);
    expect(embedder.calls).toEqual([['query text']]);
  });
});

describe('ContextDocsService.search (AC-29) — embeddings not ready', () => {
  it('returns [] with zero embed-provider calls when embeddings are disabled', async () => {
    const db = makeFakeDb([]); // no select should ever be reached
    const embedder = new SpyEmbedder();
    const container = new Container(config({ embeddingsEnabled: false }), db, { embedder });
    const service = new ContextDocsService(container);

    const results = await service.search(REPO_ID, 'query text', 3);

    expect(results).toEqual([]);
    expect(embedder.calls).toHaveLength(0);
  });
});
