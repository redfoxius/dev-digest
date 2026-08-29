import type { AgentCase } from "../../src/index.js";

export const cases: AgentCase[] = [
  {
    name: "asks blocking clarifying questions with a recommended default instead of guessing substance",
    kind: "quality",
    prompt:
      "We want to add rate limiting to the PR review endpoint. Write the spec for it. No design " +
      "source, mockup, or existing ticket exists yet — just this sentence.",
    practices: [
      "the response asks at least one blocking clarifying question whose answer would change the spec's substance (e.g. per-IP vs per-user vs per-API-key limiting, what the limit/window should be, what happens on limit exceeded) rather than inventing an answer",
      "at least one clarifying question includes a recommended default, per this agent's own documented convention",
      "the response does not write a full spec.md with invented EARS-pattern requirements before those blocking questions are answered",
    ],
    threshold: 0.65,
    maxTurns: 15,
    isolate: true,
  },
  {
    name: "asks before starting when the request names no concrete feature or design source at all",
    kind: "quality",
    prompt: "Write a spec for the next thing on our roadmap.",
    practices: [
      "the response asks what specific feature to write a spec for, rather than inventing a feature on its own",
      "the response does not produce a spec.md before a concrete feature is identified",
    ],
    threshold: 0.65,
    maxTurns: 8,
    isolate: true,
  },
];
