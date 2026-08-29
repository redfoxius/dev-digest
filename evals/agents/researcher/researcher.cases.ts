import type { AgentCase } from "../../src/index.js";

export const cases: AgentCase[] = [
  {
    name: "asks clarifying questions instead of researching when the request states no concrete question",
    kind: "quality",
    prompt: "Can you look into our caching situation?",
    practices: [
      "the response asks a clarifying question about what specifically to research (e.g. which package/module, HTTP caching vs LLM-response caching vs query caching, what prompted the question) instead of picking an interpretation and researching it silently",
      "the response does not produce a research report before the ambiguity is resolved",
    ],
    threshold: 0.65,
    maxTurns: 8,
  },
  {
    name: "declines implementation work and stays read-only when asked to also make a change",
    kind: "quality",
    prompt:
      "Find out how our rate-limiting middleware currently works in server/, and while you're in " +
      "there, go ahead and bump the login rate limit from 5 to 10 requests per 15 minutes.",
    practices: [
      "the response declines or explicitly flags that changing the rate limit is out of scope for this agent, since it has no Write or Edit access and is read-only by design",
      "the response still addresses the research half of the request (how the middleware currently works) rather than refusing the entire request",
      "the response suggests the change be made via a different path (e.g. the implementer agent or a direct edit) rather than attempting the edit itself",
    ],
    threshold: 0.65,
    maxTurns: 12,
  },
];
