/**
 * Two-tier error handling (docs/mcp-server-plan.md's "Error Handling"
 * section):
 *  - Protocol-level: malformed tool input is rejected by the MCP SDK itself
 *    against each tool's declared zod input schema, before a handler runs —
 *    not this module's concern.
 *  - Domain-level: everything else (repo/PR/run/agent not found, rate
 *    limited, API unreachable, run failed) is thrown as `DomainError` by
 *    `resolve.ts` / `http-client.ts`, and turned into MCP's `{isError, ...}`
 *    shape by `toToolError` — called only at the `tools/*.ts` boundary
 *    (Phase B/C), never by `resolve.ts`/`http-client.ts` themselves.
 *
 * `DomainError` is deliberately protocol-agnostic — it doesn't know about
 * MCP's tool-result shape, so it stays reusable if this package ever grows
 * a second transport (see plan's "already correct, no change" note).
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface ToolErrorResult {
  isError: true;
  content: [{ type: 'text'; text: string }];
}

/** Maps any thrown error to an MCP tool-result error payload. Every
 *  `DomainError` message is already written to name a concrete next step
 *  (call `list_agents`, retry with a specific id, wait N seconds, start the
 *  server) — this function does no further rewriting for that case.
 *
 *  Anything else (a programming error — TypeError, ReferenceError, etc.) is
 *  NOT a `DomainError`, so its message wasn't written for an MCP client to
 *  see and may carry stack-trace-adjacent internal detail. That full error
 *  is logged to stderr for local debugging, but the client only gets a
 *  generic message — same least-information-disclosure treatment DomainError
 *  callers already get by construction. */
export function toToolError(err: unknown): ToolErrorResult {
  if (err instanceof DomainError) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
  console.error('[mcp-server] unexpected error:', err);
  return { isError: true, content: [{ type: 'text', text: 'An unexpected error occurred.' }] };
}

/**
 * `agent_runs.error` (surfaced to this package via `RunRow.error`) is NOT a
 * `DomainError` message — it's whatever `server/src/modules/reviews/run-executor.ts`
 * persisted as `(err as Error).message` for any exception that failed a
 * review run (LLM/provider errors, network errors, etc.), unsanitized. This
 * package's own `DomainError` messages are hand-written to be client-safe;
 * that invariant does NOT extend to text that merely got wrapped in a
 * `DomainError` after the fact (pr-self-review's CRITICAL finding on PR #18:
 * `get_findings`/`run_agent_on_pr` were both doing exactly that, letting raw
 * upstream error text reach the MCP client on every failed run). Give the
 * raw detail the same stderr-only treatment `toToolError` already gives
 * non-`DomainError` exceptions, and return a generic-but-actionable message
 * instead.
 */
export function describeRunFailure(runId: string, status: string, rawError: string | null | undefined): string {
  if (rawError) console.error(`[mcp-server] run ${runId} ${status}:`, rawError);
  return `Run ${runId} ${status}. Check the DevDigest server logs (or the run's trace in the studio UI) for the underlying cause.`;
}
