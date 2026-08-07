import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionCategory, ConventionOrigin, ConventionStatus } from '@devdigest/shared';

/**
 * Conventions data-access. Workspace + repo scoped throughout. No
 * `deleteAllForRepo`/reset method — a re-scan (service.ts) never deletes
 * already-triaged rows, it only inserts new, deduped candidates (see
 * docs/conventions-extractor-plan.md, "Re-scan semantics").
 */

import type { ConventionRow } from '../../db/rows.js';
export type { ConventionRow };

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  rule: string;
  category: ConventionCategory;
  evidencePath: string;
  evidenceSnippet: string;
  evidenceLineStart?: number | null;
  evidenceLineEnd?: number | null;
  confidence: number;
  status: ConventionStatus;
  origin: ConventionOrigin;
}

export interface UpdateConventionPatch {
  rule?: string;
  category?: ConventionCategory;
  status?: ConventionStatus;
}

export interface ListConventionsFilters {
  status?: ConventionStatus;
  category?: ConventionCategory;
}

/** Normalized dedup key for re-scan: same rule text + same evidence file
 *  should never be inserted twice for a repo. */
export function dedupKey(rule: string, evidencePath: string): string {
  return `${rule.trim().toLowerCase()}::${evidencePath.trim().toLowerCase()}`;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async list(
    workspaceId: string,
    repoId: string,
    filters: ListConventionsFilters = {},
  ): Promise<ConventionRow[]> {
    const conditions = [eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)];
    if (filters.status !== undefined) conditions.push(eq(t.conventions.status, filters.status));
    if (filters.category !== undefined) conditions.push(eq(t.conventions.category, filters.category));
    return this.db
      .select()
      .from(t.conventions)
      .where(and(...conditions));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async getByIds(workspaceId: string, ids: string[]): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)));
  }

  /** `dedupKey(rule, evidence_path)` for every existing row in this repo —
   *  a re-scan skips inserting anything already covered by this set, so it
   *  can never silently duplicate or resurrect a candidate the user already
   *  triaged. */
  async existingDedupKeys(repoId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ rule: t.conventions.rule, evidencePath: t.conventions.evidencePath })
      .from(t.conventions)
      .where(eq(t.conventions.repoId, repoId));
    return new Set(rows.map((r) => dedupKey(r.rule, r.evidencePath ?? '')));
  }

  async bulkInsert(rows: InsertConvention[]): Promise<ConventionRow[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        rows.map((r) => ({
          workspaceId: r.workspaceId,
          repoId: r.repoId,
          rule: r.rule,
          category: r.category,
          evidencePath: r.evidencePath,
          evidenceSnippet: r.evidenceSnippet,
          evidenceLineStart: r.evidenceLineStart ?? null,
          evidenceLineEnd: r.evidenceLineEnd ?? null,
          confidence: r.confidence,
          status: r.status,
          origin: r.origin,
        })),
      )
      .returning();
  }

  async updatePatch(
    workspaceId: string,
    id: string,
    patch: UpdateConventionPatch,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }
}
