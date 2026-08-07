import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { DEFAULT_SKILL_DESCRIPTION, INITIAL_SKILL_VERSION } from './constants.js';
import { defaultUpdateSummary, isSkillConfigChange } from './helpers.js';

/**
 * A1 — skills data-access. Owns `skills` and `skill_versions` (and, jointly
 * with A2's agents repository, the `agent_skills` link table — A1 owns the
 * skill side: CRUD, versioning, import). Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description?: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

/** Fields a `PUT /skills/:id` may change (config fields + `enabled`). */
export interface UpdateSkillPatch {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export interface ListSkillsFilters {
  type?: SkillType;
  source?: SkillSource;
  enabled?: boolean;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string, filters: ListSkillsFilters = {}): Promise<SkillRow[]> {
    const conditions = [eq(t.skills.workspaceId, workspaceId)];
    if (filters.type !== undefined) conditions.push(eq(t.skills.type, filters.type));
    if (filters.source !== undefined) conditions.push(eq(t.skills.source, filters.source));
    if (filters.enabled !== undefined) conditions.push(eq(t.skills.enabled, filters.enabled));
    return this.db
      .select()
      .from(t.skills)
      .where(and(...conditions));
  }

  async getById(workspaceId: string, id: string, dbOrTx: Db = this.db): Promise<SkillRow | undefined> {
    const [row] = await dbOrTx
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Delete a skill (scoped to workspace). Versions/agent-links cascade.
   *  Returns false if no such skill existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Insert a skill AND record version 1 in skill_versions (immutable snapshot).
   *  Both writes run in ONE transaction — if the snapshot insert fails, the
   *  skill row is rolled back too, rather than existing with no v1 snapshot. */
  async insert(values: InsertSkill): Promise<SkillRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.skills)
        .values({
          workspaceId: values.workspaceId,
          name: values.name,
          description: values.description ?? DEFAULT_SKILL_DESCRIPTION,
          type: values.type,
          source: values.source,
          body: values.body,
          enabled: values.enabled ?? true,
          version: INITIAL_SKILL_VERSION,
          ...(values.evidenceFiles !== undefined ? { evidenceFiles: values.evidenceFiles } : {}),
        })
        .returning();
      await this.snapshotVersion(row!, INITIAL_SKILL_VERSION, 'Initial version', tx);
      return row!;
    });
  }

  /**
   * Update a skill. A real config change (name/description/type/body — NOT
   * just `enabled`) bumps the version and snapshots the new body into
   * `skill_versions` (reproducibility + the Versions tab's diff/restore).
   * `summary` is an optional one-line note for that snapshot; defaults to
   * `"Updated {field(s)}"` when the caller omits it.
   */
  /**
   * Both the skills-row update and its `skill_versions` snapshot run in ONE
   * transaction (a failed snapshot insert rolls the row update back too,
   * instead of leaving a skill with no matching version snapshot). The
   * version bump itself is an atomic `sql`${t.skills.version} + 1`` at the
   * database, not read-then-written in JS — two concurrent updates to the
   * same skill each get a distinct, correctly-serialized version via
   * Postgres' row locking, mirroring the same fix in
   * `agents/repository.ts`'s `bumpVersionAfterSkillChange`.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillPatch,
    summary?: string,
  ): Promise<SkillRow | undefined> {
    return this.db.transaction(async (tx) => {
      const existing = await this.getById(workspaceId, id, tx);
      if (!existing) return undefined;

      const configChanged = isSkillConfigChange(existing, patch);

      const [row] = await tx
        .update(t.skills)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
          ...(configChanged ? { version: sql`${t.skills.version} + 1` } : {}),
        })
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .returning();

      if (configChanged && row) {
        await this.snapshotVersion(row, row.version, summary ?? defaultUpdateSummary(existing, patch), tx);
      }
      return row;
    });
  }

  private async snapshotVersion(
    row: SkillRow,
    version: number,
    summary: string | undefined,
    dbOrTx: Db = this.db,
  ): Promise<void> {
    await dbOrTx
      .insert(t.skillVersions)
      .values({
        skillId: row.id,
        version,
        body: row.body,
        summary: summary ?? null,
      })
      .onConflictDoNothing();
  }

  // ---- skill_versions (immutable body snapshots) ---------------------------

  /** All snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }
}
