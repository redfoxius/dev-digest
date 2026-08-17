import { z } from 'zod';

/**
 * Narrow local response DTOs for the handful of DevDigest API fields this
 * package actually reads — deliberately NOT `@devdigest/shared` (see plan's
 * Architectural Constraints / docs/mcp-server-plan.md: that package is
 * already hand-copied twice, into `server/src/vendor/shared` and
 * `client/src/vendor/shared`, and has already drifted between those two
 * copies — a third hand-copy here would add a third drift surface for a
 * client that only needs a handful of fields, not the full contract).
 *
 * Every schema below is validated at the `http-client.ts` boundary (zod
 * skill: `parse-never-trust-json` — a local API response is still untrusted
 * JSON crossing a process boundary) and uses the default `.strip()` object
 * mode, so extra fields the real API returns (e.g. `agents.description`,
 * `output_schema`) are silently narrowed away rather than rejected.
 *
 * DRIFT RISK: `ConventionCategory`/`ConventionStatus` below are hand-copied
 * from `server/src/vendor/shared/contracts/knowledge.ts`'s
 * `ConventionCategory`/`ConventionStatus`, and `FindingSeverity`/
 * `FindingCategory` are hand-copied from
 * `server/src/vendor/shared/contracts/findings.ts`'s `Severity`/
 * `FindingCategory`. If the server ever adds/renames a value, these go
 * stale silently — same treatment `server/INSIGHTS.md` already gives the
 * existing two `@devdigest/shared` copies.
 */

// ---- Agents (GET /agents) --------------------------------------------------

export const AgentSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  provider: z.string(),
  model: z.string(),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

// ---- Repos (GET /repos) ----------------------------------------------------

// `GET /repos` serializes the wire field as `full_name` (snake_case) —
// server/src/modules/repos/helpers.ts:50, not the `fullName` camelCase
// Drizzle/TS field name from server/src/db/schema/repos.ts:14. Transform at
// the parse boundary so the rest of this package can keep using camelCase.
export const RepoSummarySchema = z
  .object({
    id: z.string(),
    owner: z.string(),
    name: z.string(),
    full_name: z.string(),
  })
  .transform((r) => ({ id: r.id, owner: r.owner, name: r.name, fullName: r.full_name }));
export type RepoSummary = z.infer<typeof RepoSummarySchema>;

// ---- Pulls (GET /repos/:id/pulls) ------------------------------------------

export const PullSummarySchema = z.object({
  id: z.string(),
  number: z.number().int(),
});
export type PullSummary = z.infer<typeof PullSummarySchema>;

// ---- Conventions (GET /repos/:id/conventions) ------------------------------
// See DRIFT RISK note above — hand-copied from knowledge.ts's
// ConventionCategory / ConventionStatus, not imported.

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

export const ConventionSummarySchema = z.object({
  rule: z.string(),
  category: ConventionCategory,
  status: ConventionStatus,
  confidence: z.number().min(0).max(1),
  evidence_path: z.string(),
});
export type ConventionSummary = z.infer<typeof ConventionSummarySchema>;

// ---- Review runs (POST /pulls/:id/review, GET /pulls/:id/runs) ------------

/** `POST /pulls/:id/review`'s response, narrowed to the one run this
 *  package ever triggers (one `agentId` per call → exactly one run). */
export const RunRefSchema = z.object({ run_id: z.string() });
export type RunRef = z.infer<typeof RunRefSchema>;

export const RunStatus = z.enum(['running', 'done', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunRowSchema = z.object({
  run_id: z.string(),
  status: RunStatus,
  error: z.string().nullish(),
});
export type RunRow = z.infer<typeof RunRowSchema>;

// ---- Findings / reviews (GET /pulls/:id/reviews) ---------------------------
// See DRIFT RISK note above — hand-copied from findings.ts's Severity /
// FindingCategory, not imported.

export const FindingSeverity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const FindingCategory = z.enum(['bug', 'security', 'perf', 'style', 'test']);
export type FindingCategory = z.infer<typeof FindingCategory>;

/** One finding, trimmed to the fields worth returning to an MCP client —
 *  drops `confidence`, `kind`, `trifecta_components`, `evidence`,
 *  `in_scope`, `review_id`, `id`, `accepted_at`, `dismissed_at` from the
 *  server's full `ReviewDtoFinding` (server/src/modules/reviews/helpers.ts). */
export const ConciseFindingSchema = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: FindingSeverity,
  category: FindingCategory,
  title: z.string(),
  rationale: z.string(),
  suggestion: z.string().nullish(),
});
export type ConciseFinding = z.infer<typeof ConciseFindingSchema>;

/** Raw shape of one item from `GET /pulls/:id/reviews`, narrowed to the
 *  fields `mappers.ts`'s `mapReviewToConciseResult` reads — the full
 *  `ReviewDto` also carries `id`/`pr_id`/`agent_id`/`agent_name`/`kind`/
 *  `model`/`cost_usd`/`created_at`, none of which this package surfaces. */
export const ReviewRecordSchema = z.object({
  run_id: z.string().nullish(),
  verdict: z.string().nullish(),
  summary: z.string().nullish(),
  score: z.number().nullish(),
  findings: z.array(ConciseFindingSchema),
});
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;

/** The one shared success-output shape `run_agent_on_pr` and `get_findings`
 *  both return (mappers.ts's `mapReviewToConciseResult` produces this). */
export const ConciseReviewResultSchema = z.object({
  status: z.literal('done'),
  run_id: z.string(),
  verdict: z.string().nullable(),
  summary: z.string().nullable(),
  score: z.number().nullable(),
  findings: z.array(ConciseFindingSchema),
});
export type ConciseReviewResult = z.infer<typeof ConciseReviewResultSchema>;

// ---- Blast radius (GET /pulls/:id/blast) -----------------------------------
// Hand-copied from server/src/vendor/shared/contracts/review-api.ts's
// BlastRadiusResponse (itself extending contracts/brief.ts's BlastRadius) —
// same DRIFT RISK treatment as ConventionCategory/FindingSeverity above: if
// the server ever renames/adds a field here, this copy goes stale silently.

export const BlastChangedSymbolSchema = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type BlastChangedSymbol = z.infer<typeof BlastChangedSymbolSchema>;

export const BlastCallerSchema = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCallerSchema>;

export const DownstreamImpactSchema = z.object({
  symbol: z.string(),
  callers: z.array(BlastCallerSchema),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpactSchema>;

export const BlastRadiusResultSchema = z.object({
  changed_symbols: z.array(BlastChangedSymbolSchema),
  downstream: z.array(DownstreamImpactSchema),
  summary: z.string(),
  degraded: z.boolean().nullish(),
  reason: z.string().nullish(),
  indexed_sha: z.string().nullish(),
});
export type BlastRadiusResult = z.infer<typeof BlastRadiusResultSchema>;
