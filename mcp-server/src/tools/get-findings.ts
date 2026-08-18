import { z } from 'zod';
import { toToolError } from '../errors.js';
import { mapReviewToFindingsItem } from '../mappers.js';
import { parseRepo, resolvePull, resolveRepo } from '../resolve.js';
import { PrField, RepoField } from '../schemas.js';
import type { ToolCallResult, ToolDefinition, ToolDeps } from '../tool-contract.js';
import type { ReviewRecord } from '../types.js';

/**
 * `get_findings` — fetch the findings/verdicts for a whole PR, across every
 * agent that has reviewed it. Resolves `repo`+`pr` to `pullId` (same
 * `resolve.ts` helpers as `run_agent_on_pr`), then reads `GET
 * /pulls/:id/reviews` (via `client.getReviews`) and, by default, keeps only
 * the most recent review per agent — an agent re-run on the same PR
 * shouldn't make its stale findings resurface alongside its current ones.
 * `all_runs:true` returns the full, undeduped run history instead.
 *
 * Dedup relies on the server returning reviews newest-first
 * (`desc(createdAt)`, `server/src/modules/reviews/repository/review.repo.ts:93`)
 * so the first occurrence of each `agent_id` is its latest run. A review
 * with no `agent_id` (no agent attribution) is always kept as-is — there's
 * no identity to dedup it against.
 */

const GetFindingsInputSchema = z
  .object({
    repo: RepoField,
    pr: PrField,
    all_runs: z
      .boolean()
      .optional()
      .describe(
        'If true, return every review run for this PR, including superseded re-runs of the same ' +
          'agent. Default (false/omitted): one entry per agent — its most recent run only.',
      ),
  })
  .strict();
type GetFindingsInput = z.infer<typeof GetFindingsInputSchema>;

/** Newest-first `reviews` in, one entry per `agent_id` out (first = latest).
 *  Reviews with no `agent_id` pass through unchanged. */
function dedupeByAgent(reviews: ReviewRecord[]): ReviewRecord[] {
  const seenAgents = new Set<string>();
  const result: ReviewRecord[] = [];
  for (const review of reviews) {
    if (review.agent_id == null) {
      result.push(review);
      continue;
    }
    if (seenAgents.has(review.agent_id)) continue;
    seenAgents.add(review.agent_id);
    result.push(review);
  }
  return result;
}

export function createGetFindingsTool(): ToolDefinition<GetFindingsInput> {
  return {
    name: 'get_findings',
    description:
      'Fetch the findings and verdicts for a pull request, across every agent that has reviewed it. ' +
      'Returns one entry per agent (its most recent run) by default — pass `all_runs:true` to see the ' +
      'full run history instead, including superseded re-runs.',
    inputSchema: GetFindingsInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(input: GetFindingsInput, { client }: ToolDeps): Promise<ToolCallResult> {
      try {
        const { owner, name } = parseRepo(input.repo);
        const { repoId } = await resolveRepo(client, owner, name);
        const { pullId } = await resolvePull(client, repoId, input.pr);

        const allReviews = await client.getReviews(pullId);
        const reviews = input.all_runs ? allReviews : dedupeByAgent(allReviews);
        const mappedReviews = reviews.map(mapReviewToFindingsItem);

        const result = {
          reviews: mappedReviews,
          total_findings: mappedReviews.reduce((sum, r) => sum + r.findings.length, 0),
        };
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
