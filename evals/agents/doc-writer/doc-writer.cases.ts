import type { AgentCase } from "../../src/index.js";

const PLAN_SNIPPET = `\`\`\`markdown
# docs/pr-labels-plan.md

**Status:** done

## Summary
Added automatic \`blocked-critical\` PR labeling: server/src/modules/reviews/labels.ts applies the
label whenever a review run reports a CRITICAL finding, and removes it once findings clear.

## Work Items
- W-1: labels.ts — apply/remove blocked-critical based on finding severity.
- W-2: server/test/pr-labels.test.ts — coverage for both label transitions.
\`\`\``;

export const cases: AgentCase[] = [
  {
    name: "writes feature docs that link back to the source plan instead of restating README/TESTING content",
    kind: "quality",
    prompt:
      "This feature just shipped — turn it into feature-facing documentation. Source: " +
      `docs/pr-labels-plan.md.\n\n${PLAN_SNIPPET}`,
    practices: [
      "the response proposes or writes documentation content that links back to docs/pr-labels-plan.md as its source rather than only summarizing it without attribution",
      "the response does not restate general project setup/testing instructions that already belong to README.md/TESTING.md — it links out to them instead of duplicating their content",
      "the response does not modify or write any application code (labels.ts, pr-labels.test.ts) — only documentation",
      "the response decides on a concrete docs/ location for this content, or asks where it should go if genuinely unclear, rather than leaving placement unaddressed",
    ],
    threshold: 0.65,
    maxTurns: 15,
    isolate: true,
  },
  {
    name: "asks before guessing docs/ placement when the feature/source is genuinely unclear",
    kind: "quality",
    prompt: "Write up documentation for the thing we just built.",
    practices: [
      "the response asks a clarifying question about which feature/plan/PR to document, rather than guessing a specific feature to write about",
      "the response does not produce documentation output before the source material is identified",
    ],
    threshold: 0.65,
    maxTurns: 10,
    isolate: true,
  },
];
