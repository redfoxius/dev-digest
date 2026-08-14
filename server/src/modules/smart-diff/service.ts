import type { Container } from '../../platform/container.js';
import type { Severity, SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { FindingRow } from '../../db/rows.js';
import { classifyFile } from './classifier.js';
import { computeProposedSplits } from './split.js';
import { SPLIT_SUGGESTION_TOO_BIG_LINE_THRESHOLD } from './constants.js';

/** Fixed presentation order (matches the mockup) — any role with zero files
 *  is omitted from `groups[]` entirely, never emitted empty. */
const ROLE_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/** Worse-wins ranking for two findings overlapping on the same line — no
 *  existing rank constant to reuse, this list is short enough to own locally. */
const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

/**
 * Smart Diff (Phase 2 of docs/smart-diff-plan.md) — deterministic, no-LLM
 * composition of a PR's changed files (classified by `classifyFile`, Phase 1)
 * with its latest review batch's findings and (Phase 5) per-file summaries.
 * Never calls `container.llm` itself — `pseudocode_summary` is read from
 * `review_file_summaries`, a byproduct of the Run Review LLM call persisted
 * elsewhere (`run-executor.ts`), and `proposed_splits` (Phase 6) is
 * deterministic weakly-connected-components clustering (`split.ts`) over
 * `container.repoIntel`'s already-persisted import graph — no LLM call
 * there either.
 */
export class SmartDiffService {
  constructor(private container: Container) {}

  async getSmartDiff(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [files, { reviewIds, findings }] = await Promise.all([
      this.container.reviewRepo.getPrFiles(prId),
      this.container.reviewRepo.getLatestReviewBatchFindings(prId),
    ]);
    // Reuses the SAME reviewIds the findings query above was scoped to — no
    // second "latest batch" computation.
    const summaries = await this.container.reviewRepo.getFileSummariesForReviews(reviewIds);

    const findingsByFile = new Map<string, FindingRow[]>();
    for (const f of findings) {
      const arr = findingsByFile.get(f.file);
      if (arr) arr.push(f);
      else findingsByFile.set(f.file, [f]);
    }

    const summaryByFile = new Map<string, string>();
    for (const s of summaries) {
      summaryByFile.set(s.file, s.summary);
    }

    const filesByRole = new Map<SmartDiffRole, SmartDiffFile[]>();
    // `core`-role file paths, in `pr_files` order — the only role Phase 6's
    // clustering ever considers; `wiring`/`boilerplate` are excluded entirely.
    const coreFilePaths: string[] = [];
    for (const file of files) {
      const role = classifyFile(file);
      if (role === 'core') coreFilePaths.push(file.path);
      const fileFindings = findingsByFile.get(file.path) ?? [];
      const smartDiffFile: SmartDiffFile = {
        path: file.path,
        pseudocode_summary: summaryByFile.get(file.path) ?? null,
        additions: file.additions,
        deletions: file.deletions,
        finding_lines: buildFindingLines(fileFindings),
        // Unexpanded finding count — never `finding_lines.length`, which a
        // single multi-line finding would inflate.
        findings_count: fileFindings.length,
      };
      const arr = filesByRole.get(role);
      if (arr) arr.push(smartDiffFile);
      else filesByRole.set(role, [smartDiffFile]);
    }

    const groups: SmartDiffGroup[] = ROLE_ORDER.filter(
      (role) => (filesByRole.get(role)?.length ?? 0) > 0,
    ).map((role) => ({ role, files: filesByRole.get(role)! }));

    const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

    // Phase 6 — deterministic import-graph clustering, no LLM. `edges` is the
    // repo's WHOLE (unfiltered) edge set — `edges.length === 0` means
    // repo-intel has no data for this repo at all (disabled/unindexed), and
    // that case must degrade to no suggestion, not to "every core file is
    // its own split": `computeProposedSplits` gives every `core` file its
    // own adjacency-map entry regardless of edges, so feeding it a genuinely
    // empty edge list would produce N noisy singleton splits instead of an
    // honest "nothing to suggest" — the exact case the plan's Phase 6 point 6
    // asks to degrade to `[]`. Once repo-intel DOES have real data for the
    // repo, a `core` file with no edges to any other `core` file after
    // filtering is a legitimate "unrelated to anything else changed" signal
    // and still gets its own singleton (point 5) — only the "we have zero
    // information" case short-circuits here.
    const edges = await this.container.repoIntel.getFileEdges(pull.repoId);
    const proposedSplits = edges.length > 0 ? computeProposedSplits(coreFilePaths, edges) : [];

    return {
      groups,
      split_suggestion: {
        too_big: totalLines > SPLIT_SUGGESTION_TOO_BIG_LINE_THRESHOLD,
        total_lines: totalLines,
        proposed_splits: proposedSplits,
      },
    };
  }
}

/**
 * Expands every non-dismissed finding's `start_line..end_line` range into
 * individual lines; where two findings' ranges overlap on the same line, the
 * WORSE severity wins. Always returned sorted ascending by `line` — Phase 3's
 * "click the findings badge" step scrolls to `finding_lines[0]`, so an
 * unsorted array would jump to an arbitrary line instead of the topmost one.
 */
function buildFindingLines(findings: FindingRow[]): { line: number; severity: Severity }[] {
  const severityByLine = new Map<number, Severity>();
  for (const f of findings) {
    const severity = f.severity as Severity;
    for (let line = f.startLine; line <= f.endLine; line++) {
      const existing = severityByLine.get(line);
      if (!existing || SEVERITY_RANK[severity] > SEVERITY_RANK[existing]) {
        severityByLine.set(line, severity);
      }
    }
  }
  return [...severityByLine.entries()]
    .map(([line, severity]) => ({ line, severity }))
    .sort((a, b) => a.line - b.line);
}
