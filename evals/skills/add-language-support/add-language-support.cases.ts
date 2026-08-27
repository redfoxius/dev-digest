import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "steers away from one generic node-kind-mapping config shared across languages",
    kind: "quality",
    prompt:
      "We're adding Rust support to repo-intel's indexer. To save time, I want to grow the existing " +
      "`typescript.ts` node-kind-mapping object into one generic config (functionKind, classKind, " +
      "exportKind, ...) that both typescript.ts and a new rust.ts read from, instead of writing a " +
      "separate rust.ts module. Good plan?",
    practices: [
      "the answer explicitly pushes back on folding Rust into one shared generic node-kind-mapping config, not just a soft caveat",
      "the answer explains that languages differ structurally (not just kind-name spelling), citing an example like TS/JS's export keyword AST node vs Go's naming-convention-based exported-ness, or a similarly concrete structural difference",
      "the answer recommends a separate per-language module (e.g. astgrep/langs/rust.ts) built on the language-agnostic helpers in astgrep/shared.ts instead",
      "the answer does not simply agree with the shared-config plan as a valid shortcut",
    ],
    threshold: 0.7,
    maxTurns: 8,
  },
  {
    name: "flags a live-parse-tree check as required, not optional, before trusting field positions",
    kind: "quality",
    prompt:
      "For the new language's AST parser module, I'm going to read the grammar's node-types.json and " +
      "the tree-sitter docs to figure out field names and child ordering, then write parseSymbols " +
      "directly from that — no need to actually parse a real snippet first, right? That would just " +
      "slow things down.",
    practices: [
      "the answer disagrees that docs/node-types.json alone are sufficient and insists on writing a throwaway script that parses a real snippet and inspects the tree (node.kind()/node.field()/node.children())",
      "the answer explains the risk in concrete terms — a field's position being assumed instead of checked can silently produce wrong output with no crash or type error, not just 'best practice'",
      "the answer does not accept skipping the live-parse check as a valid time-saving shortcut",
    ],
    threshold: 0.7,
    maxTurns: 8,
  },
];
