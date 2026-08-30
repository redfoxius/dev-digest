import type { EvalCase, EvalRunRecord } from "@devdigest/shared";

/**
 * Pure, colocated helpers for the Evals tab (spec §6.9, AC-30/AC-32) — case
 * list derivation (pass/fail/never-run icon, "expected N / got M" counts,
 * the last-run status line) shared between `EvalsTab.tsx`'s row list and
 * `_components/EvalCaseModal`'s status line. Kept here (the nearest common
 * ancestor) rather than promoted to `lib/` — reused by exactly these two
 * files inside one feature folder, per `frontend-ui-architecture`'s
 * "promote only once reused by 2+ UNRELATED folders" guidance. */

/** The documented (but `z.unknown()`-typed at the contract boundary) shape
   of a persisted `eval_runs.actual_output` — either the normal scored shape
   (`server/src/modules/evals/service.ts`'s `actualOutput`) or the AC-14
   failed-trace shape (`{ error }`). */
interface ActualOutput {
  findings?: unknown[];
  must_find_matched?: number;
  must_find_total?: number;
  noise_count?: number;
  kept?: number;
  dropped?: number;
  error?: string;
}

function parseActualOutput(actual: unknown): ActualOutput | null {
  if (!actual || typeof actual !== "object") return null;
  return actual as ActualOutput;
}

function isFailedTrace(actual: ActualOutput | null): actual is ActualOutput & { error: string } {
  return actual !== null && typeof actual.error === "string";
}

/** `recent_runs` is already sorted newest-first by the server
   (`EvalsService.getDashboard`) — this just finds this case's first (i.e.
   latest) entry, `undefined` when the case has never been run. */
export function latestRunForCase(recentRuns: EvalRunRecord[], caseId: string): EvalRunRecord | undefined {
  return recentRuns.find((r) => r.case_id === caseId);
}

export type CaseRunStatus = "pass" | "fail" | "never-run";

/** Derives the case list's per-row pass/fail/never-run indicator (AC-30)
   from that case's own most recent run. */
export function caseStatusIcon(lastRun: EvalRunRecord | undefined): CaseRunStatus {
  if (!lastRun) return "never-run";
  return lastRun.pass === true ? "pass" : "fail";
}

/** "expected N" — the count of `must_find` expectations the case ITSELF
   declares (its own `expected_output.expectations`), not a run's derived
   count — so it renders even for a case that has never been run. Returns 0
   for a case whose `expected_output` doesn't parse (matches AC-16's own
   zero-`must_find` vacuous-true rule). */
export function mustFindCount(evalCase: EvalCase): number {
  const output = evalCase.expected_output as { expectations?: unknown[] } | null | undefined;
  if (!output || !Array.isArray(output.expectations)) return 0;
  return output.expectations.filter(
    (e) => e && typeof e === "object" && (e as { type?: unknown }).type === "must_find",
  ).length;
}

/** "got M" — the most recent run's raw finding count (a friendly
   annotation, not the pass/fail source of truth — AC-19's note that this
   can validly disagree with "expected N"). `null` when there's no run yet,
   or the most recent run failed outright (AC-14 — no findings were ever
   produced). */
export function gotCount(lastRun: EvalRunRecord | undefined): number | null {
  if (!lastRun) return null;
  const actual = parseActualOutput(lastRun.actual_output);
  if (!actual || isFailedTrace(actual)) return null;
  return actual.findings?.length ?? 0;
}

/** `Math.round(ratio * 100)` for a 0..1 metric ratio rendered as "NN%". */
export function pct(ratio: number): number {
  return Math.round(ratio * 100);
}
