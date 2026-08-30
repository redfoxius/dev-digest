import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

/** GET /repos/:repoId/onboarding and POST .../regenerate response envelope
 *  (docs/onboarding-generator-plan.md Work Item 3, spec §10). `tour: null`
 *  when never generated; `stale` is always `false` in that case. */
export const OnboardingTourResponse = z.object({
  tour: Onboarding.nullable(),
  indexed_sha: z.string().nullable(),
  file_count: z.number().int().nullable(),
  generated_at: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  stale: z.boolean(),
});
export type OnboardingTourResponse = z.infer<typeof OnboardingTourResponse>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  summary: z.string().nullish(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

// ---- Skill stats (Stats tab — docs/skills-feature-plan.md#stats-tab--addendum) ----
export const SkillStatsAgent = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
});
export type SkillStatsAgent = z.infer<typeof SkillStatsAgent>;

export const SkillStatsCategory = z.object({
  category: z.string(),
  count: z.number().int(),
});
export type SkillStatsCategory = z.infer<typeof SkillStatsCategory>;

export const SkillStats = z.object({
  used_by: z.number().int(),
  /** 0..1, eligible runs / all runs by agents this skill is linked to, in the window. Null when the denominator is 0. */
  pull_frequency: z.number().nullable(),
  /** 0..1, accepted / (accepted+dismissed) findings from eligible runs, in the window. Null when the denominator is 0. */
  accept_rate: z.number().nullable(),
  findings_count: z.number().int(),
  agents_using_this_skill: z.array(SkillStatsAgent),
  findings_by_category: z.array(SkillStatsCategory),
});
export type SkillStats = z.infer<typeof SkillStats>;

export const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: SkillType,
  body: z.string().min(1),
});
export type CreateSkillBody = z.infer<typeof CreateSkillBody>;

// `.partial()` on `CreateSkillBody` rather than hand-duplicating its fields
// with individual `.optional()` calls — the two would otherwise drift.
export const UpdateSkillBody = CreateSkillBody.partial().extend({
  enabled: z.boolean().optional(),
  /** One-line note for the `skill_versions` snapshot this update creates. */
  summary: z.string().optional(),
});
export type UpdateSkillBody = z.infer<typeof UpdateSkillBody>;

// What a file/URL/community import extracts BEFORE it's persisted — shown in
// the drawer's preview step, editable there, then POSTed to a `*/confirm`
// endpoint (which re-validates it as CreateSkillBody + source). `name`/`body`
// require at least 1 char, same as `CreateSkillBody` — the direct-create and
// import-confirm paths create the same entity and must share a validation
// floor (an import-confirm previously accepted an empty name/body that
// direct-create would reject).
export const ImportCandidate = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  type: SkillType.default('custom'),
  body: z.string().min(1),
  /** Non-markdown archive entries — read, never executed, listed for transparency. */
  ignored_files: z.array(z.string()).default([]),
});
export type ImportCandidate = z.infer<typeof ImportCandidate>;

// ---- Conventions ----
/** Fixed vocabulary — keeps the UI's grouping/filtering and the generated
 *  skill body's sections stable; free-text categories from the model would
 *  fragment into near-duplicates ("error handling" vs "errors"). */
export const ConventionCategory = z.enum([
  'naming',
  'error-handling',
  'api-shape',
  'imports',
  'testing',
  'security',
  'formatting',
  'architecture',
  'type-safety',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/** 'model' = LLM-proposed, verified against the repo's clone before it can
 *  exist at all. 'config' = parsed deterministically per-language (TS/JS's
 *  eslint/tsconfig/prettier, Go's go.mod/golangci-lint — see
 *  `server/src/modules/conventions/langs/`) — no model call, can't
 *  hallucinate, skips verification. */
export const ConventionOrigin = z.enum(['model', 'config']);
export type ConventionOrigin = z.infer<typeof ConventionOrigin>;

export const ConventionCandidate = z.object({
  id: z.string(),
  rule: z.string(),
  category: ConventionCategory,
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  evidence_line_start: z.number().int().nullish(),
  evidence_line_end: z.number().int().nullish(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  origin: ConventionOrigin,
  /** Language id (matches `repo-intel/languages/index.ts`'s registry, e.g.
   *  'typescript'/'go'), derived in code from `evidence_path` — never
   *  asked of the model. Nullish for rows scanned before this field existed
   *  (Phase 7.4, docs/go-language-support-plan.md) and for any evidence
   *  path outside the registry. */
  language: z.string().nullish(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/** Raw model output before evidence verification — no id/status/line-range
 *  yet (those are assigned by the server after a candidate survives). */
export const RawConventionCandidate = z.object({
  rule: z.string().min(1),
  category: ConventionCategory,
  evidence_path: z.string().min(1),
  evidence_snippet: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type RawConventionCandidate = z.infer<typeof RawConventionCandidate>;

export const UpdateConventionBody = z.object({
  rule: z.string().min(1).optional(),
  category: ConventionCategory.optional(),
  status: ConventionStatus.optional(),
});
export type UpdateConventionBody = z.infer<typeof UpdateConventionBody>;

export const ExtractConventionsResponse = z.object({
  candidates: z.array(ConventionCandidate),
  sample_file_count: z.number().int(),
  scanned_at: z.string(),
});
export type ExtractConventionsResponse = z.infer<typeof ExtractConventionsResponse>;

export const SkillDraftFromConventions = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  token_count: z.number().int(),
});
export type SkillDraftFromConventions = z.infer<typeof SkillDraftFromConventions>;

export const CreateSkillFromConventionsBody = z.object({
  candidate_ids: z.array(z.string()).min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  body: z.string().min(1),
  type: SkillType,
  enabled: z.boolean().default(true),
});
export type CreateSkillFromConventionsBody = z.infer<typeof CreateSkillFromConventionsBody>;

// ---- Agents ----
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a CI review should BLOCK (REQUEST_CHANGES + fail the
// check) vs just comment. Deterministic from severities; acted on ONLY in CI.
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
  // Count of linked skills with BOTH the link and the skill itself enabled —
  // i.e. skills that would actually be injected into this agent's next
  // review prompt. Computed at read time (one grouped query, not per-row).
  skills_count: z.number().int().default(0),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
  // Per-agent override, independent of the skill's own global `enabled`.
  enabled: z.boolean(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
