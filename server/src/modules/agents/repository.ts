import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order + per-link enabled), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
  enabled: boolean;
}

/** An agent's own context-doc attachment row (path-based; no document join
 *  here — resolving the `document` field against the `context_documents`
 *  catalog is cross-module orchestration done in `service.ts` via
 *  `container.contextDocsRepo`, not this repository). */
export interface AgentContextDocRow {
  path: string;
  order: number;
  enabled: boolean;
}

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  async getById(workspaceId: string, id: string, dbOrTx: Db = this.db): Promise<AgentRow | undefined> {
    const [row] = await dbOrTx
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot).
   *  Both writes run in ONE transaction — if the snapshot insert fails, the
   *  agent row is rolled back too, rather than existing with no v1 snapshot. */
  async insert(values: InsertAgent): Promise<AgentRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.agents)
        .values({
          workspaceId: values.workspaceId,
          name: values.name,
          description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
          provider: values.provider,
          model: values.model,
          systemPrompt: values.systemPrompt,
          outputSchema: (values.outputSchema as object | undefined) ?? null,
          ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
          ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
          ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
          enabled: values.enabled ?? true,
          version: INITIAL_AGENT_VERSION,
          createdBy: values.createdBy ?? null,
        })
        .returning();
      await this.snapshotVersion(row!, INITIAL_AGENT_VERSION, tx);
      return row!;
    });
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   *
   * Both the agents-row update and its `agent_versions` snapshot run in ONE
   * transaction (a failed snapshot insert rolls the row update back too,
   * instead of leaving an agent with no matching version snapshot). The
   * version bump itself is an atomic `sql`${t.agents.version} + 1`` at the
   * database, not read-then-written in JS — two concurrent updates to the
   * same agent each get a distinct, correctly-serialized version via
   * Postgres' row locking, mirroring `bumpVersionAfterSkillChange` below.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    return this.db.transaction(async (tx) => {
      const existing = await this.getById(workspaceId, id, tx);
      if (!existing) return undefined;

      // A config-affecting change (anything except just toggling enabled) bumps version.
      const configChanged = isConfigChange(existing, patch);

      const [row] = await tx
        .update(t.agents)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
          ...(patch.model !== undefined ? { model: patch.model } : {}),
          ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
          ...(patch.outputSchema !== undefined
            ? { outputSchema: patch.outputSchema as object }
            : {}),
          ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
          ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
          ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(configChanged ? { version: sql`${t.agents.version} + 1` } : {}),
        })
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
        .returning();

      if (configChanged && row) await this.snapshotVersion(row, row.version, tx);
      return row;
    });
  }

  private async snapshotVersion(row: AgentRow, version: number, dbOrTx: Db = this.db): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id, dbOrTx);
    await dbOrTx
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending, with each link's `enabled`.
   *  Accepts a transaction handle so callers can read consistent state
   *  mid-transaction (e.g. `setSkills`' preserve-enabled read). */
  async linkedSkills(agentId: string, dbOrTx: Db = this.db): Promise<LinkedSkillRow[]> {
    const rows = await dbOrTx
      .select({ skill: t.skills, order: t.agentSkills.order, enabled: t.agentSkills.enabled })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order, enabled: r.enabled }));
  }

  async skillIdsForAgent(agentId: string, dbOrTx: Db = this.db): Promise<string[]> {
    const links = await this.linkedSkills(agentId, dbOrTx);
    return links.map((l) => l.skill.id);
  }

  /**
   * Per-agent counts of linked skills that would actually be injected into that
   * agent's next review prompt — i.e. BOTH the link's `enabled` AND the skill's
   * own global `enabled` are true. One grouped query for the whole batch (the
   * fixed 2-query pattern, not N-query — see docs/findings-by-severity-plan.md).
   */
  async skillsCountByAgentIds(agentIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (agentIds.length === 0) return counts;
    const rows = await this.db
      .select({ agentId: t.agentSkills.agentId, count: sql<number>`count(*)` })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(
        and(
          inArray(t.agentSkills.agentId, agentIds),
          eq(t.agentSkills.enabled, true),
          eq(t.skills.enabled, true),
        ),
      )
      .groupBy(t.agentSkills.agentId);
    for (const r of rows) counts.set(r.agentId, Number(r.count));
    return counts;
  }

  /** Link a skill to an agent at a given order (idempotent: upserts order).
   *  Wrapped in a transaction with the version bump so both commit or neither does. */
  async linkSkill(agentId: string, skillId: string, order: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(t.agentSkills)
        .values({ agentId, skillId, order })
        .onConflictDoUpdate({
          target: [t.agentSkills.agentId, t.agentSkills.skillId],
          set: { order },
        });
      await this.bumpVersionAfterSkillChange(agentId, tx);
    });
  }

  async unlinkSkill(agentId: string, skillId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.agentSkills)
        .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
      await this.bumpVersionAfterSkillChange(agentId, tx);
    });
  }

  /**
   * Replace the full set of linked skills for an agent with `skillIds`, assigning
   * order = index. Used by the "Skills" editor tab's drag-reorder, which now
   * submits EVERY workspace skill's id (linked and unlinked) so a drag can
   * reposition an unchecked row too. Skills not in the list are unlinked.
   *
   * Each id's current `enabled` state (from any existing agent_skills row) is
   * preserved across the replace — a pure reorder must never silently flip an
   * unrelated, currently-unchecked skill to `enabled: true` just because it
   * appears in the reordered array. Ids with no prior row default to `false`.
   *
   * The delete + re-insert + version bump all run in ONE transaction — if the
   * insert fails (a duplicate id, a stale FK, a dropped connection) the delete
   * rolls back too, instead of leaving the agent with zero linked skills.
   */
  async setSkills(agentId: string, skillIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await this.linkedSkills(agentId, tx);
      const enabledById = new Map(existing.map((l) => [l.skill.id, l.enabled]));

      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
      if (skillIds.length > 0) {
        await tx.insert(t.agentSkills).values(
          skillIds.map((skillId, i) => ({
            agentId,
            skillId,
            order: i,
            enabled: enabledById.get(skillId) ?? false,
          })),
        );
      }
      await this.bumpVersionAfterSkillChange(agentId, tx);
    });
  }

  /**
   * Upsert the per-agent `enabled` override for one skill link — checking a
   * not-yet-linked skill in the Agent Editor's Skills tab both attaches it
   * (appended at the end of the current order) AND enables it in one call;
   * unchecking a linked skill flips `enabled` on its existing row without
   * touching its `order` (never deletes on uncheck).
   */
  async setSkillEnabled(agentId: string, skillId: string, enabled: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await this.linkedSkills(agentId, tx);
      await tx
        .insert(t.agentSkills)
        .values({ agentId, skillId, order: existing.length, enabled })
        .onConflictDoUpdate({
          target: [t.agentSkills.agentId, t.agentSkills.skillId],
          set: { enabled },
        });
      await this.bumpVersionAfterSkillChange(agentId, tx);
    });
  }

  // ---- agent_context_docs link table (mirrors agent_skills — Work Item 8) --

  /** Documents attached to an agent for one repo, `order` ascending, with
   *  each link's `enabled`. Scoped to `repoId` because attachment is
   *  per-(agent, repo) — `agents` itself is workspace-scoped, but discovered
   *  documents are repo-scoped (spec §4/§9). Accepts a tx handle so callers
   *  can read consistent state mid-transaction. */
  async linkedContextDocs(
    agentId: string,
    repoId: string,
    dbOrTx: Db = this.db,
  ): Promise<AgentContextDocRow[]> {
    return dbOrTx
      .select({
        path: t.agentContextDocs.path,
        order: t.agentContextDocs.order,
        enabled: t.agentContextDocs.enabled,
      })
      .from(t.agentContextDocs)
      .where(
        and(eq(t.agentContextDocs.agentId, agentId), eq(t.agentContextDocs.repoId, repoId)),
      )
      .orderBy(asc(t.agentContextDocs.order));
  }

  /**
   * Replace the full set of attached document paths for an agent within one
   * repo, assigning order = index — the Context tab's drag-reorder bulk call
   * (AC-20). Mirrors `setSkills` exactly: each path's current `enabled`
   * state (from any existing row for this agent+repo) is preserved across
   * the replace — a pure reorder must never silently flip an unrelated,
   * currently-unchecked document to `enabled: true` just because it appears
   * in the reordered array (the documented `agent_skills` bulk-POST-vs-PATCH
   * split). Paths with no prior row default to `enabled: false`. Paths not
   * in `paths` are unlinked for this (agent, repo) pair only.
   *
   * Delete + re-insert run in ONE transaction — a failed insert rolls the
   * delete back too, instead of leaving the agent with zero attached docs.
   */
  async setAgentContextDocs(agentId: string, repoId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ path: t.agentContextDocs.path, enabled: t.agentContextDocs.enabled })
        .from(t.agentContextDocs)
        .where(
          and(eq(t.agentContextDocs.agentId, agentId), eq(t.agentContextDocs.repoId, repoId)),
        );
      const enabledByPath = new Map(existing.map((r) => [r.path, r.enabled]));

      await tx
        .delete(t.agentContextDocs)
        .where(
          and(eq(t.agentContextDocs.agentId, agentId), eq(t.agentContextDocs.repoId, repoId)),
        );
      if (paths.length > 0) {
        await tx.insert(t.agentContextDocs).values(
          paths.map((path, i) => ({
            agentId,
            repoId,
            path,
            order: i,
            enabled: enabledByPath.get(path) ?? false,
          })),
        );
      }
    });
  }

  /**
   * Upsert the per-agent `enabled` state for one attached document —
   * checking a not-yet-attached document in the Context tab both attaches it
   * (appended at the end of the current order for this agent+repo) AND
   * enables it in one call (AC-18); unchecking an attached document flips
   * `enabled` off on its existing row without touching its `order`, and
   * never deletes the row (AC-19). Mirrors `setSkillEnabled` exactly.
   */
  async setAgentContextDocEnabled(
    agentId: string,
    repoId: string,
    path: string,
    enabled: boolean,
  ): Promise<void> {
    const existing = await this.linkedContextDocs(agentId, repoId);
    await this.db
      .insert(t.agentContextDocs)
      .values({ agentId, repoId, path, order: existing.length, enabled })
      .onConflictDoUpdate({
        target: [t.agentContextDocs.agentId, t.agentContextDocs.repoId, t.agentContextDocs.path],
        set: { enabled },
      });
  }

  /**
   * Any skill-link mutation (attach/detach/reorder/enable-toggle) always bumps
   * the agent's version and snapshots `agent_versions` — unlike `update()`,
   * which only bumps on `isConfigChange`, a skill-link change is ALWAYS
   * version-worthy (the linked-skills list is part of `AgentVersionConfig`,
   * needed for eval reproducibility). No-op if the agent id doesn't exist
   * (defensive; callers already validate existence before reaching here).
   *
   * The increment itself is done AT THE DATABASE, not read-then-written in
   * JS (`sql`${t.agents.version} + 1``) — two concurrent callers each get a
   * distinct, correctly-serialized version number from Postgres' own row
   * locking, instead of racing to read the same starting value and both
   * writing the same "next" version (which silently dropped one snapshot via
   * `onConflictDoNothing` on the `(agentId, version)` PK). Always call this
   * inside the same transaction as the triggering `agent_skills` write (see
   * `linkSkill`/`unlinkSkill`/`setSkills`/`setSkillEnabled` above) so a
   * failure on either side rolls back both.
   */
  private async bumpVersionAfterSkillChange(agentId: string, tx: Db): Promise<void> {
    const [row] = await tx
      .update(t.agents)
      .set({ version: sql`${t.agents.version} + 1` })
      .where(eq(t.agents.id, agentId))
      .returning();
    if (row) await this.snapshotVersion(row, row.version, tx);
  }
}
