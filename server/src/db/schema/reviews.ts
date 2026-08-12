import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, boolean, check, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id'),
    /** The agent_run that produced this review (links the timeline run ↔ review). */
    runId: uuid('run_id'),
    kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    score: integer('score'),
    model: text('model'),
    /** USD cost of the run that produced this review; redundant with agent_runs.cost_usd (same precedent as score), null when unknown. */
    costUsd: doublePrecision('cost_usd'),
    createdAt: now(),
  },
  (t) => ({
    // reviewsForPull (repository/review.repo.ts) filters by pr_id on every PR page load.
    prIdIdx: index('reviews_pr_id_idx').on(t.prId),
  }),
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    /** Intent Layer — set by the reviewing LLM itself, only when a derived PR
     *  intent was injected into its prompt; null otherwise (no intent, or a
     *  Finding producer other than the main reviewer, e.g. lethal-trifecta). */
    inScope: boolean('in_scope'),
  },
  (t) => ({
    // reviewsForPull (repository/review.repo.ts) does an inArray lookup on review_id per PR view.
    reviewIdIdx: index('findings_review_id_idx').on(t.reviewId),
  }),
);

export const prIntent = pgTable(
  'pr_intent',
  {
    prId: uuid('pr_id')
      .primaryKey()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    intent: text('intent').notNull(),
    inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Server-side-clamped, model-self-reported confidence (0-1) — audit/log
     *  mechanism only, never rendered as a % in the UI. Every write via
     *  `upsertIntent` sets this explicitly; the default only exists so this
     *  NOT NULL column is never added to a populated table without a
     *  fallback (paired the same way `sources` already is below). */
    confidence: doublePrecision('confidence').notNull().default(0),
    /** Which data sources actually backed the derivation — a closed enum so
     *  the UI can render a fixed qualitative badge without string matching.
     *  Defaults to the lowest-trust tier for the same NOT-NULL-safety reason
     *  as `confidence` above — real writes always set this explicitly. */
    evidenceTier: text('evidence_tier', {
      enum: ['direct', 'ticket_only', 'indirect_only'],
    })
      .notNull()
      .default('indirect_only'),
    /** Audit trail of resolved (and explicitly-failed) data sources, e.g.
     *  ["pr_description", "linked_issue#42", "spec:https://...",
     *  "spec_link_unreachable:https://...", "branch_name", "commit_messages",
     *  "changed_paths", "hunk_headers"]. */
    sources: jsonb('sources').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (t) => ({
    confidenceRange: check('pr_intent_confidence_range', sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
    evidenceTierValues: check(
      'pr_intent_evidence_tier_values',
      sql`${t.evidenceTier} IN ('direct', 'ticket_only', 'indirect_only')`,
    ),
  }),
);

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
