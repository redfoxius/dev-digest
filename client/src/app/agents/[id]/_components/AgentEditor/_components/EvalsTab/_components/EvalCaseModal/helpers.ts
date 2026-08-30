import { EvalCaseExpectedOutput } from "@devdigest/shared";
import type { EvalRunRecord } from "@devdigest/shared";

/**
 * Pure helpers for `EvalCaseModal` — client-side `expected_output` JSON
 * validation (AC-32, reusing the WI-1 `EvalCaseExpectedOutput` zod schema
 * directly rather than re-deriving the shape) and the "Last run
 * passed/failed · expected N, got M · duration · cost" status line's own
 * derivation (from that run's OWN persisted `actual_output`, distinct from
 * `EvalsTab/helpers.ts`'s case-level "expected N / got M" annotation, which
 * reads the case's declared expectations instead — see that file's own
 * comment for why the two aren't the same number).
 */

export interface ExpectedOutputParseResult {
  /** Parsed `{ expectations: EvalExpectation[] }`, or `null` on failure. */
  value: unknown;
  /** Human-readable validation detail, `null` on success — Save stays
     disabled while this is non-null (AC-32). */
  error: string | null;
}

/** Empty/whitespace-only input parses as zero expectations (a case with no
   assertions yet is valid, matching AC-16/AC-17's own zero-expectation
   vacuous-true rules) — Save is not blocked by an empty editor. */
export function parseExpectedOutput(text: string): ExpectedOutputParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { value: { expectations: [] }, error: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { value: null, error: "Invalid JSON." };
  }

  const result = EvalCaseExpectedOutput.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { value: null, error: `${path}${issue?.message ?? "Doesn't match the expected shape."}` };
  }
  return { value: result.data, error: null };
}

/** Best-effort JSON parse for the Files/PR-meta raw-text fields — these stay
   `z.unknown()` at every contract boundary (spec §9), so unlike
   `expected_output` there's no shape to validate against; an unparseable,
   non-empty value is kept as its raw string rather than silently dropped. */
export function parseJsonField(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatCost(usd: number | null): string {
  if (usd == null) return "—";
  return `$${usd.toFixed(4)}`;
}

interface PersistedActualOutput {
  findings?: unknown[];
  must_find_total?: number;
  error?: string;
}

function parseActualOutput(actual: unknown): PersistedActualOutput | null {
  if (!actual || typeof actual !== "object") return null;
  return actual as PersistedActualOutput;
}

export interface LastRunStatusParts {
  passed: boolean;
  /** `null` when the run failed outright (AC-14) — no scored counts exist. */
  expected: number | null;
  got: number | null;
  duration: string;
  cost: string;
}

/** Derives the modal's one-line "Last run passed/failed · expected N, got M
   · duration · cost" status (AC-32) from a case's own most recent
   `EvalRunRecord`. */
export function lastRunStatusParts(run: EvalRunRecord): LastRunStatusParts {
  const actual = parseActualOutput(run.actual_output);
  const failed = actual !== null && typeof actual.error === "string";
  return {
    passed: run.pass === true,
    expected: failed ? null : (actual?.must_find_total ?? null),
    got: failed ? null : (actual?.findings?.length ?? null),
    duration: formatDuration(run.duration_ms),
    cost: formatCost(run.cost_usd),
  };
}
