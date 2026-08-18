import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../../server/src/adapters/mocks.js';
import { runWorkingReview } from '../../src/cli/review.js';

/**
 * Exercises the actual reused engine (parseUnifiedDiff → reviewPullRequest →
 * groundFindings) with a fake LLM — same MockLLMProvider reviewer-core's own
 * test suite uses (reviewer-core/test/run.test.ts), so this is the same
 * pipeline server/'s PR review runs, just fed a working-tree diff instead of
 * one loaded from a managed clone.
 */
describe('cli/review runWorkingReview', () => {
  const diff = [
    'diff --git a/src/config.ts b/src/config.ts',
    '--- a/src/config.ts',
    '+++ b/src/config.ts',
    '@@ -8,3 +8,4 @@',
    ' line8',
    ' line9',
    ' line10',
    '+const key = "sk_live_hardcoded";',
  ].join('\n');

  it('grounds a real finding and drops a hallucinated one', async () => {
    const fixture = {
      verdict: 'request_changes',
      summary: 'secret committed',
      score: 38,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded secret',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          rationale: 'sk_live in diff',
          confidence: 0.98,
          kind: 'finding',
        },
        {
          id: 'f-hallucinated',
          severity: 'WARNING',
          category: 'bug',
          title: 'phantom finding',
          file: 'src/config.ts',
          start_line: 999,
          end_line: 999,
          rationale: 'not real',
          confidence: 0.3,
          kind: 'finding',
        },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: fixture });

    const outcome = await runWorkingReview(diff, llm);

    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.grounding).toBe('1/2 passed');
  });

  it('a clean review with zero findings scores 100 regardless of self-reported score', async () => {
    const clean = { verdict: 'approve', summary: 'looks good', score: 5, findings: [] };
    const llm = new MockLLMProvider('openai', { structured: clean });

    const outcome = await runWorkingReview(diff, llm);

    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
  });
});
