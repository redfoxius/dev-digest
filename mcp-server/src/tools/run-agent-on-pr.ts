import { z } from 'zod';
import { DomainError, describeRunFailure, toToolError } from '../errors.js';
import { mapReviewToConciseResult } from '../mappers.js';
import { parseRepo, resolvePull, resolveRepo } from '../resolve.js';
import { PrField, RepoField } from '../schemas.js';
import type { ToolCallResult, ToolDefinition, ToolDeps } from '../tool-contract.js';
import type { AgentSummary, RunRow } from '../types.js';

/**
 * `run_agent_on_pr` — the synchronous, single-entry-point tool
 * (docs/mcp-server-plan.md's Work Item 6). Resolves `repo`+`pr` to internal
 * uuids (`resolve.ts`), resolves `agent` to an agent id (id match first,
 * else exact case-insensitive name match — `agents.name` has no uniqueness
 * constraint, `server/src/db/schema/agents.ts:13`), triggers a review run,
 * then polls `GET /pulls/:id/runs` (via `client.getRuns`) until the run
 * reaches a terminal status or `config.pollTimeoutMs` elapses. On `'done'`
 * it reuses `mappers.ts`'s `mapReviewToConciseResult` — the one shared
 * shaping helper this tool and `get_findings` both use, so the two never
 * independently drift on output shape.
 */

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

const RunAgentOnPrInputSchema = z
  .object({
    repo: RepoField,
    pr: PrField,
    agent: z.string().describe('Agent id or name — see list_agents for valid values.'),
  })
  .strict();
type RunAgentOnPrInput = z.infer<typeof RunAgentOnPrInputSchema>;

function resolveAgentId(agents: AgentSummary[], agent: string): string {
  const byId = agents.find((a) => a.id === agent);
  if (byId) return assertEnabled(byId);

  const nameMatches = agents.filter((a) => a.name.toLowerCase() === agent.toLowerCase());
  if (nameMatches.length === 0) {
    throw new DomainError(`agent '${agent}' not found — call list_agents to see valid ids.`);
  }
  if (nameMatches.length > 1) {
    const ids = nameMatches.map((a) => a.id).join(', ');
    throw new DomainError(
      `ambiguous agent name '${agent}' matches ${nameMatches.length} agents — call run_agent_on_pr ` +
        `again with one of these ids: [${ids}]`,
    );
  }
  return assertEnabled(nameMatches[0]!);
}

function assertEnabled(agent: AgentSummary): string {
  if (!agent.enabled) {
    throw new DomainError(
      `agent '${agent.name}' (${agent.id}) is disabled — call list_agents to see enabled agents.`,
    );
  }
  return agent.id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRunAgentOnPrTool(): ToolDefinition<RunAgentOnPrInput> {
  return {
    name: 'run_agent_on_pr',
    description:
      'Run a specific reviewer agent on a pull request and return its findings. Creates a new review ' +
      'run, waits for it to finish (up to ~45 seconds), and returns the verdict and findings in one ' +
      'call — no need to poll separately. Requires a valid `agent` id/name from `list_agents`.',
    inputSchema: RunAgentOnPrInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async handler(input: RunAgentOnPrInput, { client, config }: ToolDeps): Promise<ToolCallResult> {
      try {
        const { owner, name } = parseRepo(input.repo);
        const { repoId } = await resolveRepo(client, owner, name);
        const { pullId } = await resolvePull(client, repoId, input.pr);

        const agents = await client.getAgents();
        const agentId = resolveAgentId(agents, input.agent);

        const { run_id: runId } = await client.triggerReview(pullId, agentId);

        const deadline = Date.now() + config.pollTimeoutMs;
        let row: RunRow | undefined;
        for (;;) {
          const runs = await client.getRuns(pullId);
          row = runs.find((r) => r.run_id === runId);
          if (row && TERMINAL_STATUSES.has(row.status)) break;
          if (Date.now() >= deadline) break;
          await sleep(config.pollIntervalMs);
        }

        if (!row || !TERMINAL_STATUSES.has(row.status)) {
          const result = {
            status: 'running' as const,
            run_id: runId,
            message:
              `Review still in progress after ${Math.round(config.pollTimeoutMs / 1000)}s — call ` +
              `get_findings(repo, pr) once it completes`,
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
          };
        }

        if (row.status === 'failed' || row.status === 'cancelled') {
          return {
            isError: true,
            content: [{ type: 'text', text: describeRunFailure(runId, row.status, row.error) }],
          };
        }

        const reviews = await client.getReviews(pullId);
        const review = reviews.find((r) => r.run_id === runId);
        if (!review) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text:
                  `Review run ${runId} reported status 'done' but no matching review was found — ` +
                  `retry get_findings(repo, pr) shortly.`,
              },
            ],
          };
        }

        const result = mapReviewToConciseResult(review, runId);
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
