import { z } from 'zod';
import { toToolError } from '../errors.js';
import { parseRepo, resolvePull, resolveRepo } from '../resolve.js';
import { PrField, RepoField } from '../schemas.js';
import type { ToolCallResult, ToolDefinition, ToolDeps } from '../tool-contract.js';

/**
 * `get_blast_radius` (docs/blast-radius-plan.md) — which symbols a PR's diff
 * changed, who calls them, and which HTTP endpoints/cron jobs are reachable
 * from those callers. Thin proxy over `GET /pulls/:id/blast`, resolving
 * `repo`+`pr` the same way every other tool does (`resolve.ts`). No longer a
 * stub: the server route this tool calls landed alongside it.
 */

const GetBlastRadiusInputSchema = z
  .object({
    repo: RepoField,
    pr: PrField,
  })
  .strict();
type GetBlastRadiusInput = z.infer<typeof GetBlastRadiusInputSchema>;

export function createGetBlastRadiusTool(): ToolDefinition<GetBlastRadiusInput> {
  return {
    name: 'get_blast_radius',
    description:
      "Return the set of symbols/callers/HTTP-endpoints impacted by a pull request's changes: " +
      'which symbols the diff changed, who calls them, and which HTTP endpoints or cron jobs are ' +
      'reachable from those callers.',
    inputSchema: GetBlastRadiusInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(input: GetBlastRadiusInput, { client }: ToolDeps): Promise<ToolCallResult> {
      try {
        const { owner, name } = parseRepo(input.repo);
        const { repoId } = await resolveRepo(client, owner, name);
        const { pullId } = await resolvePull(client, repoId, input.pr);
        const result = await client.getBlastRadius(pullId);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (err) {
        return toToolError(err);
      }
    },
  };
}
