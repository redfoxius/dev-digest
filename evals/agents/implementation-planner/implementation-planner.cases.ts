import type { AgentCase } from "../../src/index.js";

const SPEC_SNIPPET = `\`\`\`markdown
# Spec: server/reviews/pr-labels

## AC-1
WHEN a review run finishes with at least one CRITICAL finding, the system SHALL apply a
\`blocked-critical\` label to the PR.

## AC-2
WHEN a review run finishes with zero CRITICAL or HIGH findings, the system SHALL remove any
existing \`blocked-critical\` label from the PR.
\`\`\``;

const SPEC_WITH_MARKER = `\`\`\`markdown
# Spec: server/reviews/rate-limit

## AC-1
WHEN a client exceeds the configured request rate, the system SHALL respond with 429.

## AC-2
[NEEDS CLARIFICATION] Should the rate limit be per-IP, per-user, or per-API-key?
\`\`\``;

export const cases: AgentCase[] = [
  {
    name: "every Work Item cites the spec's AC-N ids and no application code is written",
    kind: "quality",
    prompt: `Produce a Development Plan for this spec.\n\n${SPEC_SNIPPET}`,
    practices: [
      "the plan includes at least one Work Item citing AC-1 and at least one citing AC-2, using the exact 'AC-1'/'AC-2' id format",
      "the plan names specific modules/files to be touched rather than only describing the feature abstractly",
      "the plan names which project skills the implementer should apply (e.g. fastify-best-practices, onion-architecture) for at least one work item",
      "the response is a plan document, not application code — it does not include a full diff or complete file contents as if already implemented",
      "the plan does not clarify requirements/acceptance-criteria ambiguity itself — that is out of scope for this agent",
    ],
    threshold: 0.65,
    maxTurns: 15,
  },
  {
    name: "stops and reports rather than guessing when the spec has an unresolved NEEDS CLARIFICATION marker",
    kind: "quality",
    prompt: `Produce a Development Plan for this spec.\n\n${SPEC_WITH_MARKER}`,
    practices: [
      "the response stops short of producing a full Development Plan and instead reports the unresolved [NEEDS CLARIFICATION] marker on AC-2 back to the user",
      "the response does not invent an answer to the per-IP/per-user/per-API-key question on its own",
      "the response does not claim it will ask the user directly (clarifying with the user is the spec-creator agent's job, not this agent's)",
    ],
    threshold: 0.65,
    maxTurns: 10,
  },
];
