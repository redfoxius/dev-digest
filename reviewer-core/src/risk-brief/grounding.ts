import type { DiffHunk, Risk, ReviewFocusItem } from '@devdigest/shared';

/**
 * Risk Brief — grounding + output bounding (pure functions, no `Container`,
 * no DB — `specs/cross-cutting/pr-why-risk-brief/plan.md` Work Item 6,
 * spec §6.2 AC-10/AC-11/AC-12). Never trust a raw model-cited path/line
 * without validating it against real diff/blast data first. Lives in
 * `reviewer-core` (not `server/src/modules/risk-brief/`) because it's zero
 * I/O over in-memory `Risk[]`/`ReviewFocusItem[]` — the same Domain Purity
 * rule that puts `groundFindings` here for the main review pipeline.
 *
 * The output-bound caps (`MAX_RISKS`/`MAX_REVIEW_FOCUS`/`MAX_WHAT_WHY_CHARS`)
 * are server-specific config (`server/src/modules/risk-brief/constants.ts`),
 * not part of this pure algorithm — `boundRiskBriefOutput` takes them as an
 * injected `RiskBriefOutputLimits` parameter instead of importing them.
 */

/**
 * Filters each risk's `file_refs` down to paths present in `validPaths` —
 * mirrors `server/src/modules/intent/service.ts`'s own `filterRiskFileRefs`
 * (`server/src/modules/intent/service.ts:368-385`). A risk with no
 * `file_refs` to begin with always stays valid (never dropped for that
 * reason); a risk is dropped only when it HAD refs and every one failed to
 * match.
 *
 * The caller builds `validPaths` as the union of: diff file paths, blast
 * `changed_symbols[].file`, `downstream[].endpoints_affected`/
 * `crons_affected` strings, AND every `downstream[].callers[].file` (AC-10's
 * 2026-08-20 widening — without caller files here, AC-24's flagged-dot
 * indicator on `BlastRadiusCard` would be unreachable, since its flagged
 * rows ARE caller rows and callers are "frequently a file this PR never
 * touched"). This function itself just takes the already-unioned set — it
 * does not build it.
 */
export function filterRiskRefs(
  risks: Risk[] | null | undefined,
  validPaths: ReadonlySet<string> | readonly string[],
): Risk[] {
  if (!risks) return [];
  const valid = validPaths instanceof Set ? validPaths : new Set(validPaths);
  const kept: Risk[] = [];
  for (const risk of risks) {
    if (risk.file_refs.length === 0) {
      kept.push({ ...risk, file_refs: [] });
      continue;
    }
    const matched = risk.file_refs.filter((f) => valid.has(f));
    if (matched.length === 0) continue;
    kept.push({ ...risk, file_refs: matched });
  }
  return kept;
}

/**
 * Filters `review_focus[]` entries to ones citing a real diff file at a real
 * hunk new-line (AC-10/AC-11). `review_focus[]`'s valid-file set is
 * deliberately narrower than `filterRiskRefs`'s — diff files ONLY, never
 * blast callers/endpoints — Review Focus is diff-only by design (§2
 * Glossary: "always references files inside the PR's own diff, unlike Blast
 * Radius callers, which are frequently external files").
 *
 * An entry is dropped when its `file` isn't a key in `diffFilesToHunks`, or
 * when its `line` doesn't fall within any of that file's hunks'
 * `newLineNumbers` (the lines the *new* file actually contains within that
 * hunk — `DiffHunk.newLineNumbers`, `server/src/vendor/shared/adapters.ts`).
 */
export function filterReviewFocus(
  items: ReviewFocusItem[] | null | undefined,
  diffFilesToHunks: Map<string, DiffHunk[]>,
): ReviewFocusItem[] {
  if (!items) return [];
  const kept: ReviewFocusItem[] = [];
  for (const item of items) {
    const hunks = diffFilesToHunks.get(item.file);
    if (!hunks) continue;
    const inRange = hunks.some((hunk) => hunk.newLineNumbers.includes(item.line));
    if (!inRange) continue;
    kept.push(item);
  }
  return kept;
}

/** The output of `boundRiskBriefOutput` — the four capped/truncated fields
 *  that feed directly into the persisted `RiskBrief`. */
export interface BoundedRiskBriefOutput {
  risks: Risk[];
  review_focus: ReviewFocusItem[];
  what: string;
  why: string;
}

/** The caps `boundRiskBriefOutput` enforces — injected by the caller (server
 *  config, `server/src/modules/risk-brief/constants.ts`'s `MAX_RISKS` /
 *  `MAX_REVIEW_FOCUS` / `MAX_WHAT_WHY_CHARS`), never hardcoded here. */
export interface RiskBriefOutputLimits {
  maxRisks: number;
  maxReviewFocus: number;
  maxWhatWhyChars: number;
}

/**
 * Bounds the (already-grounded) output to the caller's "well above expected
 * shape, not at it" caps (AC-12), regardless of what the model returned: at
 * most `limits.maxRisks` risks, at most `limits.maxReviewFocus` review-focus
 * entries, and `what`/`why` each truncated to `limits.maxWhatWhyChars`
 * characters.
 */
export function boundRiskBriefOutput(
  risks: Risk[],
  reviewFocus: ReviewFocusItem[],
  what: string,
  why: string,
  limits: RiskBriefOutputLimits,
): BoundedRiskBriefOutput {
  return {
    risks: risks.slice(0, limits.maxRisks),
    review_focus: reviewFocus.slice(0, limits.maxReviewFocus),
    what: what.slice(0, limits.maxWhatWhyChars),
    why: why.slice(0, limits.maxWhatWhyChars),
  };
}
