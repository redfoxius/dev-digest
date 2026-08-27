import type { AgentCase } from "../../src/index.js";

const PLAN_AND_REPORT = `\`\`\`markdown
## Plan Work Item W-1 (satisfies: AC-1)
Add a \`blocked-critical\` label to the PR whenever the review run reports a CRITICAL finding.
Acceptance: server/test/pr-labels.test.ts covers the CRITICAL-finding case and asserts the label
is applied via the GitHub API.

## Implementation Report (from implementer)
W-1: DONE. Added label application logic to server/src/modules/reviews/labels.ts. Tests pass.
\`\`\`

Actual repository state you can assume as given (do not ask to re-check it further):
- server/src/modules/reviews/labels.ts:14 calls \`addLabel(pr, 'blocked-critical')\` only inside an
  \`if (findings.some(f => f.severity === 'critical'))\` block — matches the acceptance criterion.
- server/test/pr-labels.test.ts contains ONLY a test named 'does nothing when findings are empty' —
  there is no test covering the CRITICAL-finding case the acceptance criterion requires.`;

export const cases: AgentCase[] = [
  {
    name: "does not trust the implementer's DONE claim at face value — catches the missing test coverage",
    kind: "quality",
    prompt: `Verify this Work Item against its plan and Implementation Report.\n\n${PLAN_AND_REPORT}`,
    practices: [
      "the verdict for W-1 is NOT MET or UNVERIFIABLE, not MET, because the acceptance criterion's required test case (covering the CRITICAL-finding scenario) is missing from server/test/pr-labels.test.ts",
      "the response uses one of the exact three verdict labels (MET, NOT MET, or UNVERIFIABLE) rather than a different phrasing",
      "the response cites concrete evidence (the specific file/line or test file content) for its verdict rather than a bare assertion",
      "the response does not simply accept the Implementation Report's 'DONE. Tests pass.' claim without independently checking it",
    ],
    threshold: 0.7,
    maxTurns: 15,
  },
  {
    name: "flags a criterion as UNVERIFIABLE rather than guessing when reasonable people could disagree",
    kind: "quality",
    prompt:
      "Verify this Work Item: 'Improve the error message shown to the user when a PR review fails.' " +
      "Acceptance criterion: 'the error message should be clear and helpful.' The implementer changed " +
      "the error string from 'Error' to 'Review failed: the LLM provider returned a 500. Retry in a " +
      "few minutes or check provider status.' Is this criterion MET?",
    practices: [
      "the response flags this as UNVERIFIABLE (or explicitly notes the subjectivity) rather than confidently asserting MET, since 'clear and helpful' is not a strictly verifiable criterion",
      "the response explains why: two people could reasonably disagree on whether the new message is 'clear and helpful enough'",
      "the response does not fix, edit, or rewrite the error message itself — it only verifies",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
