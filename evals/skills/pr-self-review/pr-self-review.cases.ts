import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "light mode reviews only the fixed critical-tier skills, and proposes full for an auth-touching PR",
    kind: "quality",
    prompt:
      "I just ran `gh pr create` for a PR that touches server/src/modules/auth/session.ts (auth/session " +
      "logic) and reviewer-core/src/pipeline.ts. This is a normal automatic post-create trigger, no " +
      "explicit mode requested. Which skills get a review subagent, and what do you report?",
    practices: [
      "the answer treats this as light mode (the default for an automatic post-create trigger) and only runs review subagents for matched critical-tier skills (security, onion-architecture, golang-architecture, drizzle-orm-patterns, postgresql-table-design, fastify-best-practices, zod), not every matched skill",
      "the answer still lists any matched standard-tier skills in the report as skipped rather than silently dropping them",
      "because the diff touches an auth/session path, the answer proactively suggests running full mode, without actually switching to full mode on its own",
      "the answer does not claim this skill blocks `gh pr create` itself — it only affects `gh pr merge` via what gets posted",
    ],
    threshold: 0.65,
    maxTurns: 10,
  },
  {
    name: "posts as COMMENT, never a self-REQUEST_CHANGES, and gates merge via the label",
    kind: "quality",
    prompt:
      "The security-tier review subagent found a CRITICAL finding on this PR. How does pr-self-review " +
      "report that back, and what happens to `gh pr merge` afterward?",
    practices: [
      "the answer states the GitHub review is posted as COMMENT, not REQUEST_CHANGES, since GitHub blocks self-REQUEST_CHANGES",
      "the answer states a blocked-critical label gets applied to the PR because of the CRITICAL finding",
      "the answer treats this as a hard stop on gh pr merge (per this repo's convention) unless the user explicitly overrides in the same session, rather than saying the PR can be merged immediately",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
