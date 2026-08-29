import type { AgentVersion } from "@devdigest/shared";

/**
 * Pure, colocated helper for the Compare-runs view (spec §6.7 AC-22/AC-26,
 * plan Work Item 14). Kept local to `CompareRunsModal/` rather than promoted
 * to `lib/` — this is a pure function with exactly one real caller (this
 * modal) at plan time; frontend-ui-architecture's "promote only once reused
 * by 2+" guidance says leave it colocated until a second consumer appears
 * (plan's Architectural Constraints section).
 *
 * AC-22's algorithm: given the agent's full version history (already fetched
 * via `GET /agents/:id/versions`, DESC or any order — this function doesn't
 * assume ordering) and one selected trend-row's `ran_at`, resolve which
 * config was LIVE at that moment — the highest `version` whose `created_at`
 * is `<= ran_at`. Versions are immutable and strictly increasing
 * (`AgentsRepository.update`), so this reconstruction is exact.
 *
 * Returns `undefined` when no version's `created_at` is `<= ran_at` (e.g. a
 * `ran_at` predating the agent's very first version snapshot) — entirely
 * client-side, no new backend call, per the plan's Context section.
 */
export function resolveAgentVersionForBatch(
  versions: AgentVersion[],
  ranAt: string,
): AgentVersion | undefined {
  const ranAtMs = new Date(ranAt).getTime();
  let best: AgentVersion | undefined;
  for (const v of versions) {
    const createdMs = new Date(v.created_at).getTime();
    if (createdMs <= ranAtMs && (!best || v.version > best.version)) {
      best = v;
    }
  }
  return best;
}
