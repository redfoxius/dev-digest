import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "drafts a properly classified, cited entry and rejects vague ones via the anti-vague test",
    kind: "quality",
    prompt:
      "Session just ended in server/. Two candidate findings: (1) 'Found that " +
      "server/src/adapters/embeddings/openai.ts:88 silently truncates text over 8191 tokens instead of " +
      "erroring — cost us a debugging session because a review silently used a truncated diff.' (2) " +
      "'Fixed a bug in the reviews service today.' Draft the INSIGHTS.md entries for server/INSIGHTS.md.",
    practices: [
      "candidate (1) is written as an entry under a specific fixed section (e.g. 'Tool & Library Notes' or 'Recurring Errors & Fixes'), with a date and the file:line citation server/src/adapters/embeddings/openai.ts:88 preserved",
      "candidate (2) is rejected or flagged as too vague to include, per the anti-vague test ('would this surprise someone who just read the code?'), rather than written up as-is",
      "the answer writes to server/INSIGHTS.md only, not a root-level or cross-module insights file",
      "entries are appended/additive in framing, not described as rewriting or overwriting existing file content",
    ],
    threshold: 0.7,
    maxTurns: 8,
  },
  {
    name: "skips a trivial session instead of forcing an entry",
    kind: "quality",
    prompt:
      "Just finished a session in client/ where I renamed a prop from `data` to `payload` across three " +
      "components and fixed a typo in a comment. Should I run engineering-insights and what would the " +
      "entry look like?",
    practices: [
      "the answer recognizes this as a trivial session (rename + typo fix) that should produce no INSIGHTS.md entry",
      "the answer explicitly states that writing nothing is the correct outcome here, not a failure to force an entry",
      "the answer does not fabricate a generic entry just to have something to write",
    ],
    threshold: 0.65,
    maxTurns: 6,
  },
];
