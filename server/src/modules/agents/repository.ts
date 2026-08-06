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

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
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

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot). */
  async insert(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
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
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
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
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
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
