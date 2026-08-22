import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces, users } from './core';

export const repos = pgTable(
  'repos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    clonePath: text('clone_path'),
    // Per-repo gitignore-style exclude patterns for Project Context document
    // discovery (v0.2, renamed from `context_search_globs`). Three states:
    // `null` -> unconfigured; default agent-instruction-file exclude set
    // applies (`**/AGENTS.md`, `**/CLAUDE.md`, `**/.claude/**`, AC-5, AC-43).
    // `[]` -> explicitly persisted zero exclusions; every discovered `.md`
    // file is in scope (AC-6). Any other array -> the repo's own configured
    // exclude patterns, evaluated with real gitignore semantics (AC-44).
    contextSearchExcludes: text('context_search_excludes').array(),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: now(),
  },
  (t) => ({
    uq: uniqueIndex('repos_ws_fullname_uq').on(t.workspaceId, t.fullName),
    wsIdx: index('repos_ws_idx').on(t.workspaceId),
  }),
);
