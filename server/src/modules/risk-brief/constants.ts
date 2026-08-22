/**
 * Risk Brief — named constants (`specs/cross-cutting/pr-why-risk-brief/plan.md`
 * Work Item 4, spec §4/§6.2/§6.2a). Mirrors `intent/service.ts`'s own `MAX_*`
 * constant convention: one named-constant module, read from everywhere it's
 * enforced, never inlined at each call site.
 */

/** Hard cap on the assembled Risk Brief LLM input, measured via
 *  `estimateTokens` (chars/4 heuristic) before the call — enforced by
 *  trimming/dropping lower-priority sections (AC-8), not just logged.
 *  Hardcoded (not Settings-configurable) per spec §4, but placed in its own
 *  named constant as a deliberate seam for a future per-workspace override. */
export const RISK_BRIEF_INPUT_TOKEN_BUDGET = 8000;

/** Output bound — at most this many `risks[]` entries persisted/returned,
 *  regardless of what the model returns (AC-12). "Well above expected
 *  shape, not at it" bounding rationale, same as `intent/service.ts`'s
 *  own `MAX_RISKS`. */
export const MAX_RISKS = 8;

/** Output bound — at most this many `review_focus[]` entries persisted/
 *  returned, regardless of what the model returns (AC-12). */
export const MAX_REVIEW_FOCUS = 8;

/** Output bound — `what`/`why` are each truncated to this many characters,
 *  regardless of what the model returns (AC-12). */
export const MAX_WHAT_WHY_CHARS = 600;

/** Number of relevant Project Context spec excerpts pulled via the
 *  `context-docs` top-K cosine-similarity search (AC-30). */
export const RELEVANT_SPEC_K = 3;
