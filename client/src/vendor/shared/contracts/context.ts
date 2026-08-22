import { z } from 'zod';

/**
 * Project Context Folder — discovered repo documents (`specs/`, `docs/`,
 * `insights/`, or any configured search root) and their manual attachment to
 * agents/skills. See `specs/cross-cutting/project-context-folder/spec.md`
 * §9-10. Two independent mechanisms share only these contracts: (a)
 * indexing/browsing (`ContextDocument`), and (b) manual path-based
 * attachment + run-time injection (`AgentContextDocLink`/
 * `SkillContextDocLink`). Attachment always stores a path, never document
 * text.
 */

// ---- Discovery / browser ----
export const ContextDocRoot = z.enum(['specs', 'docs', 'insights']);
export type ContextDocRoot = z.infer<typeof ContextDocRoot>;

export const ContextDocIndexStatus = z.enum([
  'indexed',
  'disabled',
  'misconfigured',
  'too_large_to_index',
]);
export type ContextDocIndexStatus = z.infer<typeof ContextDocIndexStatus>;

export const ContextDocument = z.object({
  id: z.string(),
  path: z.string(),
  root: ContextDocRoot,
  size_bytes: z.number().int(),
  chunk_count: z.number().int().nullable(),
  index_status: ContextDocIndexStatus,
  used_by_agents: z.number().int(),
  used_by_skills: z.number().int(),
  last_indexed_at: z.string(),
});
export type ContextDocument = z.infer<typeof ContextDocument>;

// ---- Manual attachment (agent- and skill-scoped — identical shape) ----
export const AgentContextDocLink = z.object({
  path: z.string(),
  order: z.number().int(),
  // Per-agent/skill toggle; uncheck preserves the row (mirrors AgentSkillLink).
  enabled: z.boolean(),
  // Null when `path` no longer resolves in the latest `context_documents` scan
  // (deleted/renamed file) — the attachment row itself still survives.
  document: ContextDocument.nullable(),
});
export type AgentContextDocLink = z.infer<typeof AgentContextDocLink>;

// Skill-scoped attachment is structurally identical to the agent-scoped one.
export const SkillContextDocLink = AgentContextDocLink;
export type SkillContextDocLink = z.infer<typeof SkillContextDocLink>;

// ---- Per-repo search-root config ----
export const ContextSearchConfig = z.object({
  excludes: z.array(z.string()),
});
export type ContextSearchConfig = z.infer<typeof ContextSearchConfig>;
