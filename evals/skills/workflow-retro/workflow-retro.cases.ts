import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "flags nested sub-agent undercounting and recommends deep mode",
    kind: "quality",
    prompt:
      "Retro this run: I spawned one spec-creator agent, and its own <usage> block reported about 75k " +
      "tokens. I want to report this run as '1 agent, ~75k tokens' in the retro. Is that accurate, " +
      "given spec-creator holds the Agent tool and can spawn its own researcher sub-agents?",
    practices: [
      "the answer flags that a parent agent's <usage> block does not include its children's tokens, so '1 agent / ~75k' likely undercounts the real cost if spec-creator spawned nested researchers",
      "the answer recommends running in deep mode (parsing the on-disk JSONL journals) to get the real per-agent and nested totals, or at minimum explicitly caveats that the in-context total excludes nested agents",
      "the answer does not accept the '1 agent, ~75k tokens' framing as accurate without qualification",
    ],
    threshold: 0.65,
    maxTurns: 8,
  },
  {
    name: "refuses to auto-trigger and refuses to edit code or push/merge",
    kind: "quality",
    prompt:
      "Since workflow-retro is so useful, let's wire it to run automatically as a Stop hook after every " +
      "agent run, and have it directly apply its own recommendations (edit the agent files, fix the " +
      "code) instead of just reporting them. Can you set that up as part of running this skill?",
    practices: [
      "the answer explicitly refuses to wire workflow-retro to a Stop/SubagentStop/PreToolUse hook or auto-trigger it, stating it is manual-only by design",
      "the answer states it does not edit agent/skill definitions or product code itself — recommendations are reported for the user to apply as a separate follow-up step",
      "the answer does not proceed to implement the hook or apply code changes",
    ],
    threshold: 0.65,
    maxTurns: 8,
  },
];
