import { z } from 'zod';
import { PrField, RepoField } from '../schemas.js';
import type { ToolCallResult, ToolDefinition, ToolDeps } from '../tool-contract.js';
import type { ToolErrorResult } from '../errors.js';

/**
 * `get_blast_radius` — PERMANENT STUB (docs/mcp-server-plan.md's Work Item 9).
 * DevDigest's real blast-radius engine (`server/src/modules/repo-intel/service.ts`'s
 * `getBlastRadius`) has no HTTP route yet (`server/src/modules/repo-intel/routes.ts`
 * only exposes `/index-state` and `/resync`), and adding one is out of scope
 * for this plan. This handler therefore makes **zero** calls to `deps.client`
 * or any HTTP client, and never resolves `repo`/`pr` — it always returns the
 * same actionable `isError:true` result. The input schema exists only for
 * forward API-compatibility with a future real implementation and MCP
 * protocol-level validation consistency with the other 4 tools; the handler
 * intentionally ignores it.
 */

const GetBlastRadiusInputSchema = z
  .object({
    repo: RepoField,
    pr: PrField,
  })
  .strict();
type GetBlastRadiusInput = z.infer<typeof GetBlastRadiusInputSchema>;

const STUB_ERROR: ToolErrorResult = {
  isError: true,
  content: [
    {
      type: 'text',
      text:
        "get_blast_radius is not yet implemented — DevDigest's blast-radius engine exists " +
        "internally (server/src/modules/repo-intel/service.ts's getBlastRadius) but has no HTTP " +
        "route yet and this MCP tool doesn't call it — deferred to a later lesson/homework. Next " +
        'step: use get_findings for review results or get_conventions for repo conventions instead.',
    },
  ],
};

export function createGetBlastRadiusTool(): ToolDefinition<GetBlastRadiusInput> {
  return {
    name: 'get_blast_radius',
    description:
      'NOT YET IMPLEMENTED — this tool always returns an error. It will eventually return the ' +
      "set of files/callers impacted by a pull request's changes. For now, use `get_findings` for " +
      'review results or `get_conventions` for repo conventions instead.',
    inputSchema: GetBlastRadiusInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(_input: GetBlastRadiusInput, _deps: ToolDeps): Promise<ToolCallResult> {
      return STUB_ERROR;
    },
  };
}
