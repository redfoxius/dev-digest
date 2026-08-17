import { z } from 'zod';
import { DomainError, toToolError } from '../errors.js';
import { mapReviewToConciseResult } from '../mappers.js';
import { resolvePull, resolveRepo } from '../resolve.js';
import type { ToolCallResult, ToolDefinition, ToolDeps } from '../tool-contract.js';

/**
 * `get_findings` — fetch the findings/verdict of an already-completed review
 * run by its `run_id` (docs/mcp-server-plan.md's Work Item 7). Resolves
 * `repo`+`pr` to `pullId` (same `resolve.ts` helpers as `run_agent_on_pr`),
 * then looks the run up by `run_id` — strictly the caller-supplied id, never
 * "the latest review for this PR" (see plan's "Relevant INSIGHTS.md
 * Gotchas": picking the latest row naively drops sibling agents' data).
 *
 * Output shape on success is identical to `run_agent_on_pr`'s success case —
 * both go through `mappers.ts`'s `mapReviewToConciseResult` so the two never
 * independently drift.
 */

const GetFindingsInputSchema = z
  .object({
    repo: z
      .string()
      .describe("GitHub repo in 'owner/name' format, e.g. 'acme/payments-api'. Must already be imported into DevDigest."),
    pr: z.number().int().positive().describe('Pull request number within that repo.'),
    run_id: z
      .string()
      .uuid()
      .describe(
        'The run_id of an already-completed (or in-progress) review run, e.g. as returned by run_agent_on_pr.',
      ),
  })
  .strict();
type GetFindingsInput = z.infer<typeof GetFindingsInputSchema>;

export function createGetFindingsTool(): ToolDefinition<GetFindingsInput> {
  return {
    name: 'get_findings',
    description:
      'Fetch the findings and verdict of an already-completed review run by its `run_id`. Use this to check ' +
      'results without re-running the agent — e.g. after `run_agent_on_pr` reports the run is still in progress.',
    inputSchema: GetFindingsInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(input: GetFindingsInput, { client }: ToolDeps): Promise<ToolCallResult> {
      try {
        const [owner, name] = input.repo.split('/');
        if (!owner || !name) {
          throw new DomainError(`Repo '${input.repo}' must be in 'owner/name' format, e.g. 'acme/payments-api'.`);
        }
        const { repoId } = await resolveRepo(client, owner, name);
        const { pullId } = await resolvePull(client, repoId, input.pr);

        const reviews = await client.getReviews(pullId);
        const review = reviews.find((r) => r.run_id === input.run_id);
        if (review) {
          const result = mapReviewToConciseResult(review, input.run_id);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
          };
        }

        // Not found among completed reviews — cross-check the run rows to
        // give an accurate reason (still running / failed / never existed).
        const runs = await client.getRuns(pullId);
        const run = runs.find((r) => r.run_id === input.run_id);
        if (!run) {
          throw new DomainError(
            `No run found with id=${input.run_id} for this PR — check the id or call run_agent_on_pr again.`,
          );
        }
        if (run.status === 'running') {
          const result = { status: 'running' as const, message: 'still running, poll again' };
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
          };
        }
        // 'failed' or 'cancelled'
        throw new DomainError(run.error ?? `Run ${input.run_id} ${run.status} with no error detail recorded.`);
      } catch (err) {
        return toToolError(err);
      }
    },
  };
}
