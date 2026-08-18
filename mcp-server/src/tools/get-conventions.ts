import { z } from 'zod';
import { toToolError } from '../errors.js';
import { parseRepo, resolveRepo } from '../resolve.js';
import { RepoField } from '../schemas.js';
import { ConventionCategory } from '../types.js';
import type { ToolCallResult, ToolDefinition, ToolDeps } from '../tool-contract.js';

/**
 * `get_conventions` — repo-scoped, no PR resolution needed
 * (docs/mcp-server-plan.md's Work Item 8). Calls `resolveRepo` for
 * `owner/name` -> `repoId`, then `client.getRepoConventions(repoId, filters)`.
 * An empty `conventions` array is a normal success (extraction hasn't run
 * yet for this repo), never an error.
 *
 * Always filters `status:'accepted'` server-side — `status` is deliberately
 * NOT a caller-supplied input. A calling model has no way to judge whether a
 * `pending`/`rejected` convention is trustworthy, so surfacing those risks
 * the model treating an unreviewed or explicitly-rejected rule as if it were
 * an accepted project convention.
 *
 * `category` reuses `types.ts`'s `ConventionCategory` zod enum directly
 * (already the local mirror of
 * `server/src/vendor/shared/contracts/knowledge.ts` per that file's own
 * DRIFT RISK note) rather than redefining a second copy here.
 */

const GetConventionsInputSchema = z
  .object({
    repo: RepoField,
    category: ConventionCategory.optional(),
    language: z.string().optional(),
  })
  .strict();
type GetConventionsInput = z.infer<typeof GetConventionsInputSchema>;

export function createGetConventionsTool(): ToolDefinition<GetConventionsInput> {
  return {
    name: 'get_conventions',
    description:
      "List the ACCEPTED coding conventions DevDigest has extracted for a repository (pending and " +
      "rejected candidates are never returned). Returns an empty list if extraction hasn't been run " +
      'for this repo yet, or nothing has been accepted — that\'s not an error.',
    inputSchema: GetConventionsInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(input: GetConventionsInput, { client }: ToolDeps): Promise<ToolCallResult> {
      try {
        const { owner, name } = parseRepo(input.repo);
        const { repoId } = await resolveRepo(client, owner, name);
        const conventions = await client.getRepoConventions(repoId, {
          status: 'accepted',
          category: input.category,
          language: input.language,
        });
        const result = { conventions };
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
