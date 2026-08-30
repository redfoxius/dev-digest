import { diffLines } from "diff";
import type { EvalTrendPoint } from "@devdigest/shared";

/**
 * Pure, colocated formatting/diff helpers for the Compare-runs view (spec
 * §6.7 AC-26/AC-27, plan Work Item 14). Kept in a SEPARATE file from this
 * folder's existing `helpers.ts` deliberately — `resolveAgentVersionForBatch`
 * there is a previously-built, already-tested file this work item must not
 * modify; everything new lives here instead, following the same
 * component-folder anatomy (multiple colocated pure-helper files) already
 * used elsewhere in this codebase (e.g. `constants.ts`+`helpers.ts` side by
 * side).
 */

export interface DiffLine {
  text: string;
  type: "add" | "remove" | "same";
}

/**
 * Line-level diff between two agent versions' `config.system_prompt` values
 * (AC-27). Deliberately duplicates the shape of
 * `skills/_components/SkillDetail/_components/VersionsTab/helpers.ts`'s own
 * `computeDiffLines` (same `diffLines` library, same `DiffLine` shape) rather
 * than importing it — this codebase's own established convention for a tiny,
 * route-local pure helper is "each `<route>/_components/**' folder keeps its
 * own copy until a 4th consumer shows up" (client/INSIGHTS.md, 2026-08-06
 * `srOnly` entry; restated for `pct`/`formatRanAt` in this feature's own
 * `EvalDashboardDrilldown/helpers.ts`), not "promote on the 2nd consumer."
 */
export function computeDiffLines(oldText: string, newText: string): DiffLine[] {
  const changes = diffLines(oldText, newText);
  const lines: DiffLine[] = [];
  for (const c of changes) {
    const type = c.added ? "add" : c.removed ? "remove" : "same";
    const chunkLines = c.value.split("\n");
    // diffLines' chunk value ends with a trailing "\n" for whole-line
    // chunks — drop the resulting empty trailing entry so we don't render a
    // spurious blank row.
    if (chunkLines[chunkLines.length - 1] === "") chunkLines.pop();
    for (const text of chunkLines) lines.push({ text, type });
  }
  return lines;
}

/** True iff the diff contains at least one added/removed line — used to
   decide whether to render the diff panel or a "no difference" note. */
export function hasPromptChanged(lines: DiffLine[]): boolean {
  return lines.some((l) => l.type !== "same");
}

/** `[earlier, later]` — the two selected trend rows sorted chronologically
   ascending by `ran_at`, regardless of the order they were selected/clicked
   in (row-selection order in `EvalDashboardDrilldown` is insertion order
   into a `Set`, not necessarily chronological). ISO-8601 UTC timestamps sort
   correctly as plain strings. */
export function sortRunsByRanAtAsc(runs: [EvalTrendPoint, EvalTrendPoint]): [EvalTrendPoint, EvalTrendPoint] {
  return runs[0].ran_at <= runs[1].ran_at ? runs : [runs[1], runs[0]];
}

/** A 0..1 metric ratio (recall/precision/citation_accuracy) to 2dp, e.g.
   `0.82`. Deltas render as SIGNED values via `signedDelta` below (AC-26) —
   this one is for the plain per-run value columns. */
export function formatRatio(value: number): string {
  return value.toFixed(2);
}

/** Signed delta for a 0..1 metric ratio, e.g. `+0.04` / `-0.02` / `0.00` —
   the exact literal shape AC-26 asks for ("the numeric SIGNED delta between
   the two for each metric"). `toFixed` already prepends `-` for negative
   values; only the `+` prefix for positive values needs adding here. */
export function signedDelta(value: number, decimals = 2): string {
  const rounded = Number(value.toFixed(decimals));
  const fixed = Math.abs(rounded).toFixed(decimals);
  if (rounded > 0) return `+${fixed}`;
  if (rounded < 0) return `-${fixed}`;
  return fixed;
}

/** Signed USD delta, e.g. `+$0.010` / `-$0.005` — mirrors `lib/format.ts`'s
   `formatCost`'s 3dp convention but keeps the sign (that helper only ever
   formats a non-negative absolute cost). `null` means one or both sides'
   `cost_usd` is unknown (`EvalTrendPoint.cost_usd` is nullable) — renders as
   "—", same "unknown" convention `formatCost` itself uses. */
export function signedCostDelta(value: number | null): string {
  if (value == null) return "—";
  const fixed = Math.abs(value).toFixed(3);
  if (value > 0) return `+$${fixed}`;
  if (value < 0) return `-$${fixed}`;
  return `$${fixed}`;
}
