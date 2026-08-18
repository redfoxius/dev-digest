/* lib/blast-stats.ts — shared roll-up counts over a BlastRadiusResponse,
   used by both the Overview tab's compact BlastRadiusCard and the full
   BlastTab so the two never independently drift on how "N callers/endpoints/
   crons" is computed. docs/blast-radius-plan.md. */
import type { DownstreamImpact } from "@devdigest/shared";

export function blastRadiusCounts(downstream: DownstreamImpact[]) {
  return {
    totalCallers: downstream.reduce((sum, d) => sum + d.callers.length, 0),
    totalEndpoints: new Set(downstream.flatMap((d) => d.endpoints_affected)).size,
    totalCrons: new Set(downstream.flatMap((d) => d.crons_affected)).size,
  };
}

/** Top-N changed symbols by caller count — used by the compact Overview
   preview (BlastTab shows every symbol, unranked, since it's the full view). */
export function topBlastSymbols(downstream: DownstreamImpact[], n: number): DownstreamImpact[] {
  return [...downstream].sort((a, b) => b.callers.length - a.callers.length).slice(0, n);
}
