import { and, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ContextDocIndexStatus, ContextDocRoot } from '@devdigest/shared';
import { resolveWithinClone, verifyRealpathWithinClone } from './glob-safety.js';
import type { EmbeddedChunk } from './similarity.js';

/**
 * Project Context Folder — `context_documents`/`code_chunks` data access
 * (`docs/project-context-folder-plan.md` Work Items 3, 5, 6). The ONLY place
 * that writes `context_documents` and this module's `code_chunks` rows.
 * `agent_context_docs`/`skill_context_docs` are owned by their respective
 * modules (`agents/repository.ts`, `skills/repository.ts`) — this class only
 * READS them (join-only) for the used-by counts the browser page needs.
 */

export type ContextDocumentRow = typeof t.contextDocuments.$inferSelect;

export interface UpsertContextDocumentInput {
  path: string;
  root: ContextDocRoot;
  sizeBytes: number;
  contentHash: string;
  chunkCount: number | null;
  indexStatus: ContextDocIndexStatus;
  lastIndexedAt: Date;
}

export interface ChunkInsert {
  content: string;
  embedding: number[];
}

export class ContextDocsRepository {
  constructor(private db: Db) {}

  async listByRepo(repoId: string): Promise<ContextDocumentRow[]> {
    return this.db.select().from(t.contextDocuments).where(eq(t.contextDocuments.repoId, repoId));
  }

  async getByPath(repoId: string, path: string): Promise<ContextDocumentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.contextDocuments)
      .where(and(eq(t.contextDocuments.repoId, repoId), eq(t.contextDocuments.path, path)));
    return row;
  }

  /** Upsert-by-(repo_id, path) — a reindex always calls this for every
   *  currently discovered document (new or unchanged alike), so it must be
   *  idempotent and cheap to call every pass. */
  async upsert(repoId: string, doc: UpsertContextDocumentInput): Promise<ContextDocumentRow> {
    const [row] = await this.db
      .insert(t.contextDocuments)
      .values({
        repoId,
        path: doc.path,
        root: doc.root,
        sizeBytes: doc.sizeBytes,
        contentHash: doc.contentHash,
        chunkCount: doc.chunkCount,
        indexStatus: doc.indexStatus,
        lastIndexedAt: doc.lastIndexedAt,
      })
      .onConflictDoUpdate({
        target: [t.contextDocuments.repoId, t.contextDocuments.path],
        set: {
          root: doc.root,
          sizeBytes: doc.sizeBytes,
          contentHash: doc.contentHash,
          chunkCount: doc.chunkCount,
          indexStatus: doc.indexStatus,
          lastIndexedAt: doc.lastIndexedAt,
        },
      })
      .returning();
    return row!;
  }

  /** Removes `context_documents` rows for paths no longer discovered on this
   *  reindex. Never touches `agent_context_docs`/`skill_context_docs` — a
   *  vanished document must NOT cascade-delete an existing attachment row
   *  (AC-2; attachment is path-identified, not row-identified, per spec §9). */
  async deleteMissing(repoId: string, keepPaths: string[]): Promise<void> {
    if (keepPaths.length === 0) {
      await this.db.delete(t.contextDocuments).where(eq(t.contextDocuments.repoId, repoId));
      return;
    }
    await this.db
      .delete(t.contextDocuments)
      .where(and(eq(t.contextDocuments.repoId, repoId), notInArray(t.contextDocuments.path, keepPaths)));
  }

  /** Per-path counts of ENABLED agent/skill attachments (AC-13's
   *  `used_by_agents`/`used_by_skills`, AC-15's coverage input). Read-only
   *  join against the sibling link tables — this module never writes them. */
  async usedByCounts(repoId: string): Promise<Map<string, { agents: number; skills: number }>> {
    const [agentRows, skillRows] = await Promise.all([
      this.db
        .select({ path: t.agentContextDocs.path, count: sql<number>`count(*)` })
        .from(t.agentContextDocs)
        .where(and(eq(t.agentContextDocs.repoId, repoId), eq(t.agentContextDocs.enabled, true)))
        .groupBy(t.agentContextDocs.path),
      this.db
        .select({ path: t.skillContextDocs.path, count: sql<number>`count(*)` })
        .from(t.skillContextDocs)
        .where(and(eq(t.skillContextDocs.repoId, repoId), eq(t.skillContextDocs.enabled, true)))
        .groupBy(t.skillContextDocs.path),
    ]);

    const map = new Map<string, { agents: number; skills: number }>();
    for (const r of agentRows) map.set(r.path, { agents: Number(r.count), skills: 0 });
    for (const r of skillRows) {
      const existing = map.get(r.path) ?? { agents: 0, skills: 0 };
      existing.skills = Number(r.count);
      map.set(r.path, existing);
    }
    return map;
  }

  /**
   * Replace (delete-then-insert) a document's `code_chunks` rows — never
   * appended, so a re-embedded document never accumulates duplicate chunks
   * (spec §9 lifecycle: "replaced, not appended, whenever content_hash
   * changes"). Passing an empty `chunks` array just clears them (e.g. a
   * document that grew past the size cap since its last successful index).
   */
  async replaceChunks(
    workspaceId: string,
    repoId: string,
    path: string,
    source: 'docs' | 'spec' | 'insights',
    chunks: ChunkInsert[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.codeChunks)
        .where(and(eq(t.codeChunks.repoId, repoId), eq(t.codeChunks.path, path)));
      if (chunks.length > 0) {
        await tx.insert(t.codeChunks).values(
          chunks.map((c) => ({
            workspaceId,
            repoId,
            path,
            content: c.content,
            embedding: c.embedding,
            source,
          })),
        );
      }
    });
  }

  /**
   * Top-K similarity-search input (`specs/cross-cutting/pr-why-risk-brief`
   * spec §6.2a/AC-29): every already-embedded `code_chunks` row for `repoId`
   * whose `source` is `'docs'`, `'spec'`, or `'insights'` — **never**
   * `'code'` (the column's own default,
   * `server/src/db/schema/context.ts:45-47`). Ranking code-content chunks
   * into a Risk Brief prompt would leak raw repository source into an LLM
   * call (AC-27), so the `source` exclusion is enforced TWICE: the SQL
   * `inArray` in the `WHERE` clause below, and a defense-in-depth JS-level
   * filter on the returned rows — the second guard means this guarantee
   * survives a future edit that accidentally weakens/removes the `WHERE`
   * clause, and (deliberately) makes it unit-testable without Postgres via
   * a fake `Db` that doesn't itself apply `WHERE` filtering (this
   * codebase's established fake-`Db` shape, `server/test/onboarding.test.ts`'s
   * `makeFakeDb`). Also excludes rows with a `null` `embedding` (not yet
   * chunked/embedded, or `embeddingsEnabled` was off at index time).
   */
  async getEmbeddedChunks(repoId: string): Promise<EmbeddedChunk[]> {
    const rows = await this.db
      .select({
        id: t.codeChunks.id,
        path: t.codeChunks.path,
        content: t.codeChunks.content,
        embedding: t.codeChunks.embedding,
        source: t.codeChunks.source,
      })
      .from(t.codeChunks)
      .where(
        and(
          eq(t.codeChunks.repoId, repoId),
          isNotNull(t.codeChunks.embedding),
          inArray(t.codeChunks.source, ['docs', 'spec', 'insights']),
        ),
      );
    return rows
      .filter((r) => r.source !== 'code')
      .map((r) => ({ id: r.id, path: r.path, content: r.content, embedding: r.embedding! }));
  }

  /**
   * Read-time defense-in-depth (AC-41, security skill): resolves `path`
   * against `clonePath` via `resolveWithinClone` — the SAME guard
   * `glob-safety.ts` exposes for write-time glob validation (AC-7) — then
   * `verifyRealpathWithinClone` to catch a symlink that lexically sits
   * inside `clonePath` but resolves outside it on disk, before ever
   * touching the filesystem for real content. A `context_documents` row is
   * trusted to already be repo-relative (it only ever came from `reader.ts`'s
   * own walk, which itself skips symlinks), but this is the second,
   * independent check the security posture calls for. Returns `null` on any
   * escape/read failure; the caller maps that to a 404, never a 500.
   */
  async readPreviewContent(clonePath: string, path: string): Promise<string | null> {
    const resolved = resolveWithinClone(clonePath, path);
    if (!resolved) return null;
    const verified = await verifyRealpathWithinClone(clonePath, resolved);
    if (!verified) return null;
    try {
      return await readFile(verified, 'utf8');
    } catch {
      return null;
    }
  }
}
