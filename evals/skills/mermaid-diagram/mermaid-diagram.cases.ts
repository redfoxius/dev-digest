import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "produces a labeled sequence diagram for an API request flow, not a flowchart",
    kind: "quality",
    prompt:
      "Create a Mermaid diagram showing this flow: a client calls POST /reviews on the API server; the " +
      "server validates the request, then calls the LLM provider to generate a review, then writes the " +
      "result to Postgres, then returns the response to the client.",
    grounding: ["```mermaid"],
    practices: [
      "the diagram uses sequenceDiagram (not flowchart) since this is a request/response interaction over time between distinct participants",
      "every arrow/message in the diagram has a text label describing what it represents, not unlabeled bare arrows",
      "the diagram is wrapped in a fenced ```mermaid code block",
      "the diagram distinguishes request arrows from response arrows (e.g. solid vs dashed) consistent with sequence-diagram conventions",
    ],
    threshold: 0.65,
    maxTurns: 8,
  },
  {
    name: "keeps a large system diagram under ~20 nodes by grouping with subgraphs",
    kind: "quality",
    prompt:
      "I need a flowchart of our whole system: client (Next.js), 12 different API route handlers, the " +
      "Postgres database with 8 tables, the reviewer-core package with 5 internal modules, and the " +
      "mcp-server with its 5 tools. Show everything.",
    practices: [
      "the answer does not draw all 30+ individual nodes flat on one diagram; it groups related nodes into subgraphs (e.g. one subgraph per package/service) or explicitly proposes splitting into multiple diagrams",
      "the answer explains or demonstrates staying near the ~20 node guideline rather than producing an unreadably dense single diagram",
    ],
    // 2 practices → 0.6 sat above the 0.5 bucket, requiring both even when the diagram itself is
    // correctly grouped (the structural fact) and only the prose narration of why is missing.
    threshold: 0.5,
    maxTurns: 8,
  },
];
