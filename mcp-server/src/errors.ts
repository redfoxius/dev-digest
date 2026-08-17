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
 *  server) — this function does no further rewriting for that case. */
export function toToolError(err: unknown): ToolErrorResult {
  const text =
    err instanceof DomainError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  return { isError: true, content: [{ type: 'text', text }] };
}
