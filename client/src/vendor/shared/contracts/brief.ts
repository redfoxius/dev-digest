import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Risks ----
// Declared before Intent — Intent.risks references Risk, and these are
// `const` object literals evaluated at module-load time in file order.
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- Intent ----
/** How strongly the derivation is backed by real signal — a closed enum so
 * the UI can render a fixed qualitative badge (never a numeric %). */
export const EvidenceTier = z.enum(['direct', 'ticket_only', 'indirect_only']);
export type EvidenceTier = z.infer<typeof EvidenceTier>;

export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  /** Server-side-clamped confidence (0-1) — audit/log/clamp mechanism only,
   * never rendered as a percentage in the UI. */
  confidence: z.number().min(0).max(1),
  evidence_tier: EvidenceTier,
  /** Audit trail of resolved (and explicitly-failed) data sources. */
  sources: z.array(z.string()),
  /** Notable risk areas surfaced by the same classifier call — human-facing
   *  PR-brief concern, never fed back into the reviewer prompt. */
  risks: z.array(Risk),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risk Brief ----
// Declared after Risk/RiskSeverity (risks[] reuses Risk) and after
// BlastRadius (ordering not load-bearing here, but keeps this block after
// every building block it conceptually composes) — see the TDZ-ordering note
// atop this file.
export const ReviewFocusItem = z.object({
  /** Always one of the PR's diff file paths (server-validated). */
  file: z.string(),
  /** Always within a real hunk's new-line range for `file` (server-validated). */
  line: z.number().int(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

export const RiskBrief = z.object({
  what: z.string().max(600),
  why: z.string().max(600),
  /** Model-judged directly — never aggregated server-side from risks[].severity. */
  risk_level: RiskSeverity,
  risks: z.array(Risk).max(8),
  review_focus: z.array(ReviewFocusItem).max(8),
  /** Cache-freshness fingerprint — the PR's head_sha at generation time. */
  pr_head_sha: z.string(),
  provider: z.string(),
  model: z.string(),
  generated_at: z.string(),
});
export type RiskBrief = z.infer<typeof RiskBrief>;

/** POST /pulls/:id/brief response shape — always populated, never a bare
 * error for an LLM-side failure. */
export const RiskBriefGenerateResult = z.object({
  brief: RiskBrief.nullable(),
  cached: z.boolean().optional(),
  degraded_reason: z.enum(['llm_failed', 'input_too_large']).optional(),
});
export type RiskBriefGenerateResult = z.infer<typeof RiskBriefGenerateResult>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  /** One entry per highlighted line — can outnumber `findings_count` once a
   * single finding's `start_line..end_line` range is expanded; where two
   * findings overlap on a line, the WORSE severity wins. */
  finding_lines: z.array(z.object({ line: z.number().int(), severity: Severity })),
  /** Count of distinct findings touching the file (unexpanded) — the "N
   * findings" badge must use this, never `finding_lines.length`. */
  findings_count: z.number().int(),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;
