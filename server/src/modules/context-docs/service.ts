import type { Container } from '../../platform/container.js';
import type {
  ContextDocIndexStatus,
  ContextDocRoot,
  ContextDocument,
  ContextSearchConfig,
  Embedder,
} from '@devdigest/shared';
import { ConfigError, NotFoundError } from '../../platform/errors.js';
import { ContextDocsRepository, type ContextDocumentRow } from './repository.js';
import { DEFAULT_CONTEXT_GLOBS, discoverContextDocs } from './reader.js';
import { chunkMarkdown } from './chunker.js';
import { rankBySimilarity, type RankedChunk } from './similarity.js';

/**
 * Project Context Folder — reader/reindex, search-root config, and browser
 * business logic (spec §6.1-6.4, `docs/project-context-folder-plan.md` Work
 * Items 3, 4, 5, 6). No HTTP and no `drizzle-orm` import here — persistence
 * goes through `ContextDocsRepository`; cross-module reads (`repos.clonePath`
 * / `repos.context_search_globs`) go through `container.reposRepo`, never a
 * direct `schema.repos` query (onion-architecture "Anti-Patterns").
 */

/** AC-11 — files above this size are recorded but never chunked/embedded.
 *  Exported so tests can reference the exact boundary instead of
 *  duplicating the magic number. */
export const MAX_INDEXABLE_BYTES = 1_048_576; // 1 MB

type AggregateIndexStatus = 'indexed' | 'not_indexed' | 'disabled' | 'misconfigured';

export interface ContextDocsListResult {
  documents: ContextDocument[];
  index_status: AggregateIndexStatus;
  file_count: number;
  total_chunk_count: number | null;
  last_indexed_at: string | null;
  /** AC-15 — % of discovered documents attached (enabled) to ≥1 agent/skill.
   *  Not part of spec §10's literal response table, but computed here since
   *  no dedicated stats endpoint exists in this module's scope; harmless
   *  extra field for a zod `.parse()` consumer (unknown keys are stripped by
   *  default, never rejected). */
  coverage_percent: number;
}

type EmbedResolution =
  | { status: 'disabled' }
  | { status: 'misconfigured' }
  | { status: 'ready'; embedder: Embedder };

/** `context_documents.root` uses 'specs' (plural); `code_chunks.source`
 *  uses 'spec' (singular) — see `server/INSIGHTS.md`/plan Gotchas. */
function rootToChunkSource(root: ContextDocRoot): 'docs' | 'spec' | 'insights' {
  return root === 'specs' ? 'spec' : root;
}

export class ContextDocsService {
  private repo: ContextDocsRepository;

  constructor(private container: Container) {
    this.repo = new ContextDocsRepository(container.db);
  }

  /** GET /repos/:repoId/context-docs */
  async list(workspaceId: string, repoId: string): Promise<ContextDocsListResult> {
    const repoRow = await this.getOwnedRepo(workspaceId, repoId);
    if (!repoRow.clonePath) return this.notIndexedResult();

    const rows = await this.repo.listByRepo(repoId);
    const embedResolution = await this.resolveEmbedStatus();
    return this.buildListResult(repoId, rows, embedResolution.status);
  }

  /** POST /repos/:repoId/context-docs/reindex */
  async reindex(workspaceId: string, repoId: string): Promise<ContextDocsListResult> {
    const repoRow = await this.getOwnedRepo(workspaceId, repoId);
    if (!repoRow.clonePath) return this.notIndexedResult();

    const globs = repoRow.contextSearchGlobs?.length ? repoRow.contextSearchGlobs : DEFAULT_CONTEXT_GLOBS;
    const discovered = await discoverContextDocs(repoRow.clonePath, globs);

    const existingRows = await this.repo.listByRepo(repoId);
    const existingByPath = new Map(existingRows.map((r) => [r.path, r]));

    const embedResolution = await this.resolveEmbedStatus();

    const keepPaths: string[] = [];
    for (const doc of discovered) {
      keepPaths.push(doc.path);
      const existing = existingByPath.get(doc.path);
      const contentUnchanged = existing?.contentHash === doc.contentHash;

      let chunkCount: number | null = null;
      let indexStatus: ContextDocIndexStatus;

      if (doc.sizeBytes > MAX_INDEXABLE_BYTES) {
        // AC-11 — still recorded/visible/attachable, just never chunked.
        indexStatus = 'too_large_to_index';
        if (existing?.chunkCount) {
          await this.repo.replaceChunks(
            repoRow.workspaceId,
            repoId,
            doc.path,
            rootToChunkSource(doc.root),
            [],
          );
        }
      } else if (embedResolution.status !== 'ready') {
        // AC-9 / AC-10 — discovery still completes; chunking is skipped.
        indexStatus = embedResolution.status;
      } else if (contentUnchanged && existing?.indexStatus === 'indexed') {
        // AC-38 — never re-embed an unchanged, already-successfully-indexed
        // document. (A doc that was previously 'disabled'/'misconfigured'/
        // 'too_large_to_index' with the SAME hash still needs a first-time
        // embed now that embeddings are ready — only a prior 'indexed'
        // result short-circuits.)
        chunkCount = existing.chunkCount;
        indexStatus = 'indexed';
      } else {
        const chunks = chunkMarkdown(doc.content);
        const embeddings = chunks.length > 0 ? await embedResolution.embedder.embed(chunks) : [];
        await this.repo.replaceChunks(
          repoRow.workspaceId,
          repoId,
          doc.path,
          rootToChunkSource(doc.root),
          chunks.map((content, i) => ({ content, embedding: embeddings[i]! })),
        );
        chunkCount = chunks.length;
        indexStatus = 'indexed';
      }

      await this.repo.upsert(repoId, {
        path: doc.path,
        root: doc.root,
        sizeBytes: doc.sizeBytes,
        contentHash: doc.contentHash,
        chunkCount,
        indexStatus,
        lastIndexedAt: new Date(),
      });
    }

    // AC-2 — removes only vanished paths; agent/skill attachment rows for
    // those paths are never touched here (a different module's tables).
    await this.repo.deleteMissing(repoId, keepPaths);

    const rows = await this.repo.listByRepo(repoId);
    return this.buildListResult(repoId, rows, embedResolution.status);
  }

  /** GET /repos/:repoId/context-config */
  async getConfig(workspaceId: string, repoId: string): Promise<ContextSearchConfig> {
    const repoRow = await this.getOwnedRepo(workspaceId, repoId);
    return { globs: repoRow.contextSearchGlobs?.length ? repoRow.contextSearchGlobs : DEFAULT_CONTEXT_GLOBS };
  }

  /** PUT /repos/:repoId/context-config — the route's zod schema already
   *  rejected any escaping glob with a 422 before this runs (AC-7). */
  async setConfig(workspaceId: string, repoId: string, globs: string[]): Promise<ContextSearchConfig> {
    await this.getOwnedRepo(workspaceId, repoId);
    const updated = await this.container.reposRepo.updateContextSearchGlobs(workspaceId, repoId, globs);
    if (!updated) throw new NotFoundError('Repo not found');
    return { globs: updated.contextSearchGlobs?.length ? updated.contextSearchGlobs : DEFAULT_CONTEXT_GLOBS };
  }

  /** GET /repos/:repoId/context-docs/preview?path=... — read-only; no
   *  write/edit endpoint exists anywhere in this module (AC-14). */
  async preview(workspaceId: string, repoId: string, path: string): Promise<{ path: string; content: string }> {
    const repoRow = await this.getOwnedRepo(workspaceId, repoId);
    if (!repoRow.clonePath) throw new NotFoundError('Document not found');

    const doc = await this.repo.getByPath(repoId, path);
    if (!doc) throw new NotFoundError('Document not found');

    const content = await this.repo.readPreviewContent(repoRow.clonePath, path);
    if (content === null) throw new NotFoundError('Document not found');

    return { path, content };
  }

  /**
   * Top-K cosine-similarity search over indexed Project Context chunks
   * (`specs/cross-cutting/pr-why-risk-brief` spec §6.2a/AC-29) — new
   * capability, no prior consumer. Not workspace-scoped/ownership-checked
   * here: this is an internal read a future caller (the Risk Brief
   * service) already resolves a `repoId` for via its own ownership check
   * (mirrors `resolveEmbedStatus()`'s own status-only, no-ownership-check
   * shape) — no route exposes this method directly (spec §12 — "no public
   * search route").
   *
   * Degrades to `[]` (never throws, never blocks a caller) whenever
   * embeddings aren't `'ready'` — mirrors this same class's `reindex()`/
   * `list()` treatment of `resolveEmbedStatus()`.
   */
  async search(repoId: string, query: string, k: number): Promise<RankedChunk[]> {
    const embedResolution = await this.resolveEmbedStatus();
    if (embedResolution.status !== 'ready') return [];

    const [queryEmbedding] = await embedResolution.embedder.embed([query]);
    const chunks = await this.repo.getEmbeddedChunks(repoId);
    return rankBySimilarity(queryEmbedding!, chunks, k);
  }

  /** Ownership check mirroring the existing `GET /pulls/:id/blast` pattern
   *  (AC-40) — a repo id from another workspace never resolves. */
  private async getOwnedRepo(workspaceId: string, repoId: string) {
    const repoRow = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    return repoRow;
  }

  /**
   * Cheap, network-free status check — mirrors `container.embedder()`'s own
   * throw-before-any-OpenAI-call/catch-and-degrade contract
   * (`platform/container.ts:264-277`). Constructing the embedder only reads
   * the local secrets file, never calls the network; safe to call from BOTH
   * `list()` (GET) and `reindex()` (POST) so the aggregate `index_status`
   * always reflects the CURRENT flag/secret state, not a stale snapshot from
   * whenever reindex last ran.
   */
  private async resolveEmbedStatus(): Promise<EmbedResolution> {
    if (!this.container.config.embeddingsEnabled) return { status: 'disabled' };
    try {
      const embedder = await this.container.embedder();
      return { status: 'ready', embedder };
    } catch (err) {
      if (err instanceof ConfigError) return { status: 'misconfigured' };
      throw err;
    }
  }

  private notIndexedResult(): ContextDocsListResult {
    return {
      documents: [],
      index_status: 'not_indexed',
      file_count: 0,
      total_chunk_count: null,
      last_indexed_at: null,
      coverage_percent: 0,
    };
  }

  private async buildListResult(
    repoId: string,
    rows: ContextDocumentRow[],
    embedStatus: EmbedResolution['status'],
  ): Promise<ContextDocsListResult> {
    const usedBy = await this.repo.usedByCounts(repoId);

    const documents: ContextDocument[] = rows.map((r) => {
      const counts = usedBy.get(r.path) ?? { agents: 0, skills: 0 };
      return {
        id: r.id,
        path: r.path,
        root: r.root as ContextDocRoot,
        size_bytes: r.sizeBytes,
        chunk_count: r.chunkCount,
        index_status: r.indexStatus as ContextDocIndexStatus,
        used_by_agents: counts.agents,
        used_by_skills: counts.skills,
        last_indexed_at: r.lastIndexedAt.toISOString(),
      };
    });

    const topLevelStatus: AggregateIndexStatus = embedStatus === 'ready' ? 'indexed' : embedStatus;

    const totalChunkCount =
      topLevelStatus === 'disabled' || topLevelStatus === 'misconfigured'
        ? null
        : documents.reduce((sum, d) => sum + (d.chunk_count ?? 0), 0);

    const lastIndexedAt =
      rows.length > 0
        ? rows
            .reduce((latest, r) => (r.lastIndexedAt > latest ? r.lastIndexedAt : latest), rows[0]!.lastIndexedAt)
            .toISOString()
        : null;

    const attachedCount = documents.filter((d) => d.used_by_agents > 0 || d.used_by_skills > 0).length;
    const coveragePercent = documents.length > 0 ? Math.round((attachedCount / documents.length) * 100) : 0;

    return {
      documents,
      index_status: topLevelStatus,
      file_count: documents.length,
      total_chunk_count: totalChunkCount,
      last_indexed_at: lastIndexedAt,
      coverage_percent: coveragePercent,
    };
  }
}
