import type { LLMProvider } from '@devdigest/shared';
import { reviewPullRequest, type ReviewOutcome } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '@devdigest/server/diff-parser';
import { GENERAL_REVIEWER_PROMPT, DEFAULT_MODEL } from '@devdigest/server/review-defaults';
import { REVIEW_STRATEGY } from '@devdigest/server/review-constants';

/**
 * Runs the SAME engine + domain logic server/'s ReviewRunExecutor uses for a
 * PR (reviewPullRequest from reviewer-core, the built-in General Reviewer
 * prompt/model/strategy) against a raw working-tree diff. No repo-intel,
 * skills, or intent — those need a persisted repo row this CLI never has;
 * omitting them degrades the prompt to the pre-enrichment shape, the same
 * fallback run-executor.ts itself uses when repo-intel is off.
 */
export async function runWorkingReview(diffRaw: string, llm: LLMProvider): Promise<ReviewOutcome> {
  const diff = parseUnifiedDiff(diffRaw);
  return reviewPullRequest({
    systemPrompt: GENERAL_REVIEWER_PROMPT,
    model: DEFAULT_MODEL,
    diff,
    llm,
    strategy: REVIEW_STRATEGY,
    task: 'Review local working tree changes (uncommitted, pre-push).',
  });
}
