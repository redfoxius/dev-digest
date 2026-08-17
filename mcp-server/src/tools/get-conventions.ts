import { z } from 'zod';
import { toToolError } from '../errors.js';
import { parseRepo, resolveRepo } from '../resolve.js';
import { ConventionCategory, ConventionStatus } from '../types.js';
import type { ToolCallResult, ToolDefinition, ToolDeps } from '../tool-contract.js';

/**
 * `get_conventions` — repo-scoped, no PR resolution needed
 * (docs/mcp-server-plan.md's Work Item 8). Calls `resolveRepo` for
 * `owner/name` -> `repoId`, then `client.getRepoConventions(repoId, filters)`.
 * An empty `conventions` array is a normal success (extraction hasn't run
 * yet for this repo), never an error.
 *
 * `status`/`category` reuse `types.ts`'s `ConventionStatus`/`ConventionCategory`
 * zod enums directly (already the local mirror of
 * `server/src/vendor/shared/contracts/knowledge.ts` per that file's own
 * DRIFT RISK note) rather than redefining a second copy here.
 */

const GetConventionsInputSchema = z
  .object({
    repo: z.string(),
    status: ConventionStatus.optional(),
    category: ConventionCategory.optional(),
    language: z.string().optional(),
  })
  .strict();
type GetConventionsInput = z.infer<typeof GetConventionsInputSchema>;

export function createGetConventionsTool(): ToolDefinition<GetConventionsInput> {
  return {
    name: 'get_conventions',
    description:
      "List the coding conventions DevDigest has extracted for a repository. Returns an empty " +
      "list if convention extraction hasn't been run for this repo yet — that's not an error.",
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
          status: input.status,
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
