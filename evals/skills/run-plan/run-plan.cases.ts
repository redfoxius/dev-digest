import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "asks for the plan path rather than guessing when none is given",
    kind: "quality",
    prompt: "Run the plan for the new review-cost feature.",
    practices: [
      "the answer asks for the plan's path (a plan:<path> argument) instead of guessing which docs/ or specs/ file to use",
      "the answer does not proceed to spawn implementer agents or start Step 0 before a concrete plan path is provided",
    ],
    threshold: 0.65,
    maxTurns: 6,
  },
  {
    name: "runs the AC-N traceability preflight as a mechanical text diff, not a spawned agent",
    kind: "quality",
    prompt:
      "plan:specs/reviews/pr-why-risk-brief/plan.md — the plan's Spec section names " +
      "specs/reviews/pr-why-risk-brief/spec.md. Walk me through Step 0.5 of running this plan.",
    practices: [
      "the answer describes running plain grep/text-diff commands itself (e.g. grep -oE for AC-N ids in the spec vs the plan) rather than spawning an agent to do this comparison",
      "the answer describes stopping before Step 1 and reporting uncovered AC-N ids if the spec has AC-N ids missing from the plan, instead of proceeding anyway",
      "the answer does not skip Step 0.5 just because a spec is cited",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
