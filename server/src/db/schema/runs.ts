import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';
import { skills } from './skills';

// ============================================================ Observability

/**
 * One row per `POST /pulls/:id/review` call (single agent or "run all") —
 * groups the `agent_runs` it produced so the PR list can identify "every
 * agent from the LAST review action" instead of picking whichever single
 * run happened to finish last.
 */
export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  provider: text('provider'),
  model: text('model'),
  durationMs: integer('duration_ms'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  status: text('status'),
  /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
  error: text('error'),
  source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
  findingsCount: integer('findings_count'),
  grounding: text('grounding'),
  /** Review score (0-100) for this run; null on failed/cancelled runs. */
  score: integer('score'),
  /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
  blockers: integer('blockers'),
  /** USD cost of this run; null when unknown (unpriced model or the run never completed an LLM call). */
  costUsd: doublePrecision('cost_usd'),
  /**
   * The `multi_agent_runs` batch this run belongs to. Null on runs created
   * before this column existed; those are treated as their own singleton
   * batch by the PR-list aggregation in `pulls/routes.ts`.
   */
  multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, {
    onDelete: 'set null',
  }),
});

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

/**
 * One row per (run, skill) actually resolved/attached for that run — the
 * queryable record `run_traces.trace.prompt_assembly.skills` can't provide
 * (a concatenated markdown blob, not per-skill rows). Feeds the Skill
 * Editor's Stats tab (pull frequency, findings-by-category, etc). Inserted
 * at skill-resolution time, before the LLM call, independent of whether the
 * run later succeeds or fails.
 */
export const agentRunSkills = pgTable(
  'agent_run_skills',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.runId, t.skillId] }) }),
);
