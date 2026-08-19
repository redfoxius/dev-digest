import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Project context

/**
 * One row per markdown file discovered under a repo's configured search
 * roots (`specs/`, `docs/`, `insights/` by default). Refreshed wholesale by
 * each reindex — rows are created/updated/deleted purely by the reindex
 * scan (spec §9 lifecycle), never by direct user action.
 */
export const contextDocuments = pgTable(
  'context_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    // Repo-relative path, e.g. "specs/public-api.md". Unique per (repo, path).
    path: text('path').notNull(),
    // Derived solely from which configured search-root glob matched (AC-3) —
    // never a separate content-based classification step.
    root: text('root', { enum: ['specs', 'docs', 'insights'] }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    // Content hash for change detection — skips re-embedding an unchanged
    // file on reindex (AC-38).
    contentHash: text('content_hash').notNull(),
    // Null when embeddings disabled/misconfigured/skipped (too large);
    // real chunk count otherwise.
    chunkCount: integer('chunk_count'),
    indexStatus: text('index_status', {
      enum: ['indexed', 'disabled', 'misconfigured', 'too_large_to_index'],
    }).notNull(),
    lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }).notNull(),
    createdAt: now(),
  },
  (t) => ({
    // (repo_id, path) uniqueness also serves as the repo_id-only access path
    // (leftmost-prefix), so no separate repo_id index is needed.
    repoPathUq: uniqueIndex('context_documents_repo_path_uq').on(t.repoId, t.path),
  }),
);

/**
 * Manual agent-level attachment — stored as a path, never document text or a
 * `context_documents` foreign key (spec §4's hard constraint), so a vanished
 * `context_documents` row does NOT cascade-delete this row (AC-2).
 *
 * Mirrors `agentSkills` (`./agents.ts`) exactly: composite PK, `enabled`
 * default `true` (uncheck preserves the row), `order` for full-list
 * drag-reorder (attached and unattached rows alike, AC-20).
 */
export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    // Needed because `agents` is workspace-scoped while documents are
    // repo-scoped (spec §4) — the active-repo the attachment was made under.
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
    // Uncheck preserves the row (AC-19) — same semantics as agent_skills.enabled.
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.repoId, t.path] }),
    // `repo_id` is the FK to `repos.id` but sits second in the composite PK,
    // so it isn't a usable leftmost-prefix index — Postgres doesn't
    // auto-index FK columns. Without this, a cascade delete on `repos`
    // (or any repo-scoped lookup) has to scan this table.
    repoIdIdx: index('agent_context_docs_repo_id_idx').on(t.repoId),
  }),
);

/**
 * Manual skill-level attachment — identical shape to `agentContextDocs`,
 * keyed by (skill_id, repo_id, path) instead of agent_id (spec §9).
 */
export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.repoId, t.path] }),
    // Same rationale as `agent_context_docs`'s `repoIdIdx` above.
    repoIdIdx: index('skill_context_docs_repo_id_idx').on(t.repoId),
  }),
);
