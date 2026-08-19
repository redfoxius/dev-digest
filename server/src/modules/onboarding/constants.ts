/**
 * Local sizing knobs for `OnboardingService.assembleFacts`
 * (docs/onboarding-generator-plan.md Work Item 5). Every one of these bounds
 * a read this feature adds on TOP of `repo-intel`'s own already-bounded reads
 * (`getRepoMap`'s own `DEFAULT_REPO_MAP_TOKEN_BUDGET`, `getTopFilesByRank`/
 * `getCriticalPaths`'s existing hard count caps) — sized so the assembled
 * "extra" facts payload (top-files list, critical paths, a bounded slice of
 * file edges, caller signatures, key-file excerpts, run-facts) stays inside
 * that SAME reused token budget, regardless of repo size (AC-14/AC-37).
 */

/** How many top-ranked files seed the Guided Reading Path — consumed
 *  strictly via `repoIntel.getTopFilesByRank`'s existing `rank`/`percentile`
 *  ordering, never re-derived. */
export const TOP_FILES_N = 20;

/** `getFileEdges` is genuinely unbounded (unlike `getRepoMap`/
 *  `getCriticalPaths`) — this feature imposes its own cap after the call. */
export const MAX_FILE_EDGES = 100;

/** Bounded `getFileContent` excerpts for the highest-ranked files — a small,
 *  fixed number of short excerpts, never the whole file. */
export const MAX_KEY_FILE_EXCERPTS = 5;
export const MAX_EXCERPT_CHARS = 400;

/** How many cross-file caller signatures `getCallerSignatures` may return,
 *  seeded from the top-ranked files (mirrors this facade's own
 *  `MAX_CALLERS_PER_SYMBOL`-style per-feature cap elsewhere). */
export const MAX_CALLER_SIGNATURES = 20;

/** Wall-clock bound on facts assembly itself (the `repo-intel` reads + run-
 *  facts extraction), independent of the LLM call's own timeout — mirrors
 *  `intent/service.ts`'s `SPEC_BODY_READ_TIMEOUT_MS` precedent (AC-38). On
 *  expiry, Regenerate aborts BEFORE ever calling `container.llm(...)`. */
export const FACTS_ASSEMBLY_TIMEOUT_MS = 20_000;

/** Each persisted section's `body` is capped at this many characters, with a
 *  trailing truncation marker — guards against a runaway completion (AC-18,
 *  mirrors `intent/service.ts`'s `MAX_INTENT_CHARS` convention). */
export const MAX_SECTION_BODY_CHARS = 6_000;
export const TRUNCATION_MARKER = '...[truncated]';

/** The 5 fixed section kinds this feature always requests, in this exact
 *  order (AC-15) — reused by both the rendered prompt and the model's own
 *  structured-output schema/persist-time validation. */
export const ONBOARDING_SECTION_KINDS = [
  'architecture',
  'critical_paths',
  'how_to_run',
  'reading_path',
  'first_tasks',
] as const;
export type OnboardingSectionKind = (typeof ONBOARDING_SECTION_KINDS)[number];
