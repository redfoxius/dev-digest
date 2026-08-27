import type { AgentCase } from "../../src/index.js";

const PLAN_TASK = `\`\`\`markdown
## Task T-1
Action: Add a GET /health route to server/ returning { status: "ok" }.
Module: server
Type: route
Skills to use: fastify-best-practices
Owned paths: server/src/routes/health.ts
Depends-on: none
Acceptance: server/test/health.test.ts asserts a 200 response with { status: "ok" }.
\`\`\``;

const AMBIGUOUS_TASK = `\`\`\`markdown
## Task T-2
Action: Improve the error response shape for validation failures.
Module: server
Owned paths: server/src/routes/reviews.ts
Acceptance: errors are handled better.
\`\`\``;

export const cases: AgentCase[] = [
  {
    name: "applies the plan's named skill and stays within its acceptance criterion, without committing or pushing",
    kind: "quality",
    prompt: `Execute this Development Plan task.\n\n${PLAN_TASK}`,
    practices: [
      "the response describes applying fastify-best-practices conventions to the new route (e.g. schema validation, plugin encapsulation) rather than ignoring the named skill",
      "the response stays scoped to the route + its test, matching the Owned paths (server/src/routes/health.ts) rather than describing changes to unrelated files",
      "the response does not describe running git commit, git push, or opening a pull request — those are explicitly out of scope for this agent",
      "the response does not describe performing an architectural or security review of its own change — that's a separate agent's job",
    ],
    threshold: 0.65,
    maxTurns: 20,
    isolate: true,
  },
  {
    name: "asks a clarifying question instead of guessing when the acceptance criterion is too vague to implement against",
    kind: "quality",
    prompt: `Execute this Development Plan task.\n\n${AMBIGUOUS_TASK}`,
    practices: [
      "the response flags that 'errors are handled better' is too vague an acceptance criterion to implement against and asks a clarifying question (e.g. what should the new error shape look like, which validation failures are in scope) instead of guessing one",
      "the response does not proceed to make speculative changes before the ambiguity is resolved",
    ],
    threshold: 0.65,
    maxTurns: 12,
    isolate: true,
  },
];
