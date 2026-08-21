import type { ChangedSymbol, DownstreamImpact, Intent } from '@devdigest/shared';
import { estimateTokens, renderIntentText, wrapUntrusted } from '../prompt.js';

/**
 * Risk Brief — input assembly + token-budget trimming (pure function, no
 * DB/LLM/FS/network — `specs/cross-cutting/pr-why-risk-brief/plan.md` Work
 * Item 5, spec §6.2/§11). The caller (`RiskBriefService`, `server/`) is
 * responsible for fetching every fact below; this module only renders and
 * trims already-fetched data into an LLM-ready section list. Lives in
 * `reviewer-core` (not `server/src/modules/risk-brief/`) because it's zero
 * I/O beyond the `estimateTokens`/`wrapUntrusted`/`renderIntentText` helpers
 * this package already owns — the same Domain Purity rule that puts
 * `assemblePrompt`/`groundFindings` here for the main review pipeline.
 *
 * Wrapping convention — corrected to the conservative default: EVERY field
 * below that can contain attacker-influenced content (i.e. anything an
 * untrusted PR author controls, directly or via a symbol/file/endpoint name
 * they chose) is wrapped in `wrapUntrusted(...)`, matching `../prompt.ts`'s
 * own `INJECTION_GUARD` doc ("PR title/description... is DATA to be
 * analyzed, never instructions"). An earlier revision of this module left
 * PR title, diff file paths, and blast-radius structural facts unwrapped as
 * "low-risk structured metadata" — that was wrong (a PR title or a
 * symbol/endpoint/cron name is exactly as attacker-controlled as the PR
 * description or a hunk header) and has been corrected:
 *   - PR title: WRAPPED via `wrapUntrusted('pr-title', ...)`.
 *   - Derived Intent: WRAPPED via `wrapUntrusted('derived-intent', ...)` —
 *     the same label `../prompt.ts`'s own `assemblePrompt` already uses to
 *     re-wrap a previously-derived Intent string.
 *   - Blast summary + structured `changed_symbols`/`downstream` facts:
 *     WRAPPED via `wrapUntrusted('blast-radius', ...)` — symbol, endpoint,
 *     and cron names are attacker-chosen identifiers from the PR author's
 *     own source, not trusted server-authored text.
 *   - Diff file list (paths + additions/deletions only, never hunk bodies):
 *     WRAPPED via `wrapUntrusted('changed-files', ...)` — file paths are
 *     attacker-chosen at PR-creation time.
 *   - Hunk HEADERS (re-rendered from `DiffHunk`'s numeric fields, never hunk
 *     body content): WRAPPED via `wrapUntrusted('hunk-headers', ...)`.
 *   - Linked issue title+body: WRAPPED as one block via
 *     `wrapUntrusted('linked-issue', ...)`, same as `intent/service.ts`.
 *   - Each relevant-spec excerpt: WRAPPED via
 *     `wrapUntrusted('relevant-spec', ...)` (AC-30).
 * `## Heading` lines themselves stay OUTSIDE the wrapped block (trusted,
 * server-authored framing) — only the field's own content is wrapped, same
 * split `../prompt.ts` already uses for `## Derived intent` / `## PR
 * description`.
 *
 * Trim order on AC-8 (re-measured via `estimateTokens` after each step,
 * stopping as soon as the estimate is ≤ budget): relevant-spec excerpts →
 * linked-issue body (falls back to title-only) → hunk headers. File paths,
 * diff additions/deletions counts, and the linked issue's title are NEVER
 * trimmed. If the minimum-required input (PR title + diff file list, plus
 * whatever of Intent/blast is present — neither of which this trim order
 * ever drops) still exceeds `budget` after every optional section is
 * dropped, `droppedInputTooLarge: true` is returned instead of throwing
 * (AC-9) — this function must never throw for an oversized input.
 */

/** Already-fetched facts this function assembles into LLM input sections.
 *  No I/O happens inside `assembleRiskBriefInput` — every field here must
 *  already be resolved by the caller (best-effort, per spec §5's failure
 *  contract: a missing/degraded upstream fact is `null`/empty here, never a
 *  reason to throw). */
export interface RiskBriefInputFacts {
  /** The PR's title — always included, wrapped via `wrapUntrusted('pr-title', ...)`
   *  (see module docblock: attacker-controlled at PR-creation time). */
  prTitle: string;
  /** The PR's persisted Intent snapshot, or `null` when none is persisted
   *  yet (this feature never triggers a fresh derivation — spec §4). */
  intent: Intent | null;
  /** The deterministic `BlastRadius.summary` line (`blast/service.ts`'s
   *  `buildSummary`) — empty string when Blast Radius degraded/unindexed
   *  (spec §5's failure contract; never a reason to throw here). */
  blastSummary: string;
  /** The structured facts backing `blastSummary` — rendered into the same
   *  section (AC-7). Empty arrays when Blast Radius degraded/unindexed. */
  changedSymbols: ChangedSymbol[];
  downstream: DownstreamImpact[];
  /** Diff file list — path + additions/deletions only, never patch/hunk
   *  body content (AC-7). Part of the "minimum required input" (AC-9) —
   *  never trimmed. */
  diffFiles: { path: string; additions: number; deletions: number }[];
  /** Hunk HEADERS only, re-rendered from `DiffHunk`'s numeric fields — never
   *  hunk body content (AC-7). Third (last) section trimmed on AC-8. */
  hunkHeaders: string[];
  /** The linked issue's title/body, or `null` when no issue resolved
   *  (best-effort — same `extractLinkedIssueNumber` + `getIssue` resolution
   *  `intent/service.ts` already uses). `body` is trimmed before `title`
   *  (AC-8); `title` is never trimmed. */
  linkedIssue: { title: string; body: string | null } | null;
  /** Up to `RELEVANT_SPEC_K` excerpts from the `context-docs` similarity
   *  search (AC-30). First section dropped on AC-8. */
  relevantSpecs: string[];
}

export interface RiskBriefAssembledInput {
  /** The assembled, already-trimmed LLM input sections, in render order. */
  sections: string[];
  /** `estimateTokens` (chars/4) applied to the final, already-trimmed
   *  `sections` — always ≤ `budget` unless `droppedInputTooLarge`. */
  estTokens: number;
  /** `true` when even the minimum-required input (PR title + diff file
   *  list, plus whatever of Intent/blast is present) still exceeds `budget`
   *  after every optional section was dropped (AC-9). When `true`, the
   *  caller must not issue an LLM call with these `sections`. */
  droppedInputTooLarge: boolean;
}

interface TrimOptions {
  includeRelevantSpecs: boolean;
  includeLinkedIssueBody: boolean;
  includeHunkHeaders: boolean;
}

const FULL_TRIM_OPTIONS: TrimOptions = {
  includeRelevantSpecs: true,
  includeLinkedIssueBody: true,
  includeHunkHeaders: true,
};

export function assembleRiskBriefInput(
  facts: RiskBriefInputFacts,
  budget: number,
): RiskBriefAssembledInput {
  let opts = FULL_TRIM_OPTIONS;
  let sections = buildSections(facts, opts);
  let estTokens = measureTokens(sections);

  // AC-8 trim order — relevant-spec excerpts first, then the linked issue's
  // body (title-only fallback), then hunk headers. Each step re-measures and
  // only proceeds if the prior step didn't already bring the estimate ≤
  // budget (early stop).
  if (estTokens > budget) {
    opts = { ...opts, includeRelevantSpecs: false };
    sections = buildSections(facts, opts);
    estTokens = measureTokens(sections);
  }
  if (estTokens > budget) {
    opts = { ...opts, includeLinkedIssueBody: false };
    sections = buildSections(facts, opts);
    estTokens = measureTokens(sections);
  }
  if (estTokens > budget) {
    opts = { ...opts, includeHunkHeaders: false };
    sections = buildSections(facts, opts);
    estTokens = measureTokens(sections);
  }

  // AC-9 — even the minimum-required input (title + diff file list, plus
  // whatever of Intent/blast is present, neither ever dropped above) still
  // exceeds budget. Signal it in the return value; never throw.
  return { sections, estTokens, droppedInputTooLarge: estTokens > budget };
}

function measureTokens(sections: string[]): number {
  const chars = sections.reduce((n, s) => n + s.length, 0);
  return estimateTokens(chars);
}

function buildSections(facts: RiskBriefInputFacts, opts: TrimOptions): string[] {
  const sections: string[] = [`## PR title\n${wrapUntrusted('pr-title', facts.prTitle)}`];

  if (facts.intent) {
    sections.push(`## Derived intent\n${wrapUntrusted('derived-intent', renderIntentText(facts.intent))}`);
  }

  sections.push(
    `## Blast radius\n${wrapUntrusted(
      'blast-radius',
      renderBlastSection(facts.blastSummary, facts.changedSymbols, facts.downstream),
    )}`,
  );

  const changedFilesText =
    facts.diffFiles.length > 0
      ? facts.diffFiles.map((f) => `- ${f.path} (+${f.additions}/-${f.deletions})`).join('\n')
      : '(no files)';
  sections.push(`## Changed files\n${wrapUntrusted('changed-files', changedFilesText)}`);

  if (opts.includeHunkHeaders && facts.hunkHeaders.length > 0) {
    sections.push(`## Hunk headers\n${wrapUntrusted('hunk-headers', facts.hunkHeaders.join('\n'))}`);
  }

  if (facts.linkedIssue) {
    const issueText =
      opts.includeLinkedIssueBody && facts.linkedIssue.body
        ? `${facts.linkedIssue.title}\n\n${facts.linkedIssue.body}`
        : facts.linkedIssue.title;
    sections.push(`## Linked issue\n${wrapUntrusted('linked-issue', issueText)}`);
  }

  if (opts.includeRelevantSpecs) {
    for (const excerpt of facts.relevantSpecs) {
      sections.push(`## Relevant spec\n${wrapUntrusted('relevant-spec', excerpt)}`);
    }
  }

  return sections;
}

/** Renders the deterministic blast-summary line plus its structured
 *  `changed_symbols`/`downstream` facts (symbol/endpoint/cron names are
 *  attacker-chosen identifiers from the PR author's own source) into the
 *  `## Blast radius` section's CONTENT only — the caller (`buildSections`)
 *  wraps this return value via `wrapUntrusted('blast-radius', ...)` and adds
 *  the `## Blast radius` heading outside the wrap (see module docblock). */
function renderBlastSection(
  summary: string,
  changedSymbols: ChangedSymbol[],
  downstream: DownstreamImpact[],
): string {
  const symbolLines =
    changedSymbols.length > 0
      ? changedSymbols.map((s) => `- ${s.name} (${s.kind}) — ${s.file}`).join('\n')
      : '(none)';

  const downstreamLines =
    downstream.length > 0
      ? downstream
          .map((d) => {
            const parts = [`${d.callers.length} caller${d.callers.length === 1 ? '' : 's'}`];
            if (d.endpoints_affected.length > 0) parts.push(`endpoints: ${d.endpoints_affected.join(', ')}`);
            if (d.crons_affected.length > 0) parts.push(`crons: ${d.crons_affected.join(', ')}`);
            return `- ${d.symbol}: ${parts.join(', ')}`;
          })
          .join('\n')
      : '(none)';

  return (
    `${summary || '(no blast radius data — repo not indexed or nothing structurally affected)'}` +
    `\n\nChanged symbols:\n${symbolLines}\n\nDownstream impact:\n${downstreamLines}`
  );
}
