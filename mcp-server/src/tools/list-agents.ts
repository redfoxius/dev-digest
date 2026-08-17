import { z } from 'zod';
import { toToolError } from '../errors.js';
import type { ToolCallResult, ToolDefinition, ToolDeps } from '../tool-contract.js';

/**
 * `list_agents` — no input. Calls `GET /agents` (via `client.getAgents()`)
 * and returns the concise `{agents:[...]}` shape a calling model needs to
 * pick a valid `agent` id/name for `run_agent_on_pr` (docs/mcp-server-plan.md's
 * Work Item 5). `types.ts`'s `AgentSummary` is already this narrow shape
 * (drops `description`/`output_schema`/`strategy`/`ci_fail_on`/`repo_intel`/
 * `skills_count`/`version`), so no further mapping is needed here.
 */

const ListAgentsInputSchema = z.object({}).strict();
type ListAgentsInput = z.infer<typeof ListAgentsInputSchema>;

export function createListAgentsTool(): ToolDefinition<ListAgentsInput> {
  return {
    name: 'list_agents',
    description:
      'List the reviewer agents configured in this DevDigest workspace. Call this first to get a ' +
      'valid `agent` id or name before calling `run_agent_on_pr`.',
    inputSchema: ListAgentsInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(_input: ListAgentsInput, { client }: ToolDeps): Promise<ToolCallResult> {
      try {
        const agents = await client.getAgents();
        const result = { agents };
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
