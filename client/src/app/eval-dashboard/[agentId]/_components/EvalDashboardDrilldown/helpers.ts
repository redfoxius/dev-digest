import type { EvalTrendPoint } from "@devdigest/shared";

/**
 * Pure, colocated helpers for the Eval Dashboard drilldown (spec §6.10
 * AC-34, plan Work Item 13). Kept local to this route rather than promoted
 * to `lib/` — no other route needs them yet (frontend-ui-architecture's
 * "promote only once reused by 2+ unrelated folders" guidance).
 */

/** `Math.round(ratio * 100)` for a 0..1 metric ratio rendered as "NN%" —
   same convention as `AgentEditor/_components/EvalsTab/helpers.ts`'s own
   `pct` and the list page's `EvalDashboardRow`'s own copy; each route keeps
   its own copy until a 4th consumer shows up (client/INSIGHTS.md,
   2026-08-14 entry). */
export function pct(ratio: number): number {
  return Math.round(ratio * 100);
}

/** Deterministic (locale/timezone-independent) "Ran at" formatting for the
   Recent Runs table — `toLocaleString()` would make component test
   assertions flaky across CI/dev machines in different timezones. */
export function formatRanAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** `trend[]` is already chronological (oldest → newest, AC-23) — the Recent
   Runs table renders it newest-first (plan WI-13: "trend[] IS the
   batch-level Recent Runs data... newest first"). ISO-8601 UTC timestamps
   sort correctly as plain strings, so no `Date` parsing is needed here. */
export function sortRunsDescending(trend: EvalTrendPoint[]): EvalTrendPoint[] {
  return [...trend].sort((a, b) => (a.ran_at < b.ran_at ? 1 : a.ran_at > b.ran_at ? -1 : 0));
}

/**
 * Toggles row `index`'s selection state, enforcing the "exactly 2 rows
 * selectable at a time" rule (plan WI-13): unchecking an already-selected
 * row always works; checking a new one only succeeds while fewer than 2 are
 * already selected — a 3rd attempted selection is silently ignored (the
 * Set is returned unchanged), never throws, never evicts an existing pick.
 */
export function toggleRowSelection(selected: Set<number>, index: number): Set<number> {
  const next = new Set(selected);
  if (next.has(index)) {
    next.delete(index);
  } else if (next.size < 2) {
    next.add(index);
  }
  return next;
}
