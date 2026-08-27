import type { SkillCase } from "../../src/index.js";

const SCHEMA_SNIPPET = `\`\`\`typescript
const payloadSchema = z.object({
  metadata: z.any(),
  email: z.string(),
});

interface Payload {
  metadata: unknown;
  email: string;
}

function handleRequest(body: unknown) {
  const data = payloadSchema.parse(body);
  return data;
}
\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "flags z.any(), parse() on user input, and a hand-written type instead of z.infer",
    kind: "quality",
    prompt: `Review this Zod usage for best-practice issues, handleRequest is called directly on incoming HTTP request bodies.\n\n${SCHEMA_SNIPPET}`,
    practices: [
      "the review flags metadata: z.any() and recommends z.unknown() instead for type safety",
      "the review flags payloadSchema.parse(body) on user-controlled request input and recommends safeParse() instead so validation failures don't throw uncaught",
      "the review flags the separately hand-written Payload interface as redundant/risk-of-drift and recommends z.infer<typeof payloadSchema> instead",
    ],
    threshold: 0.7,
    maxTurns: 8,
  },
  {
    name: "recommends catch() over a try/catch wrapper for fault-tolerant defaults",
    kind: "quality",
    prompt:
      "I want a schema field that falls back to a default value whenever parsing fails, instead of " +
      "throwing. My plan is to wrap every .parse() call at every call site in a try/catch and return a " +
      "hardcoded default in the catch block. Good approach?",
    practices: [
      "the answer recommends using Zod's catch() on the schema itself for fault-tolerant parsing, rather than wrapping every call site in try/catch",
      "the answer explains this centralizes the fallback in the schema definition instead of duplicating try/catch logic everywhere",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
];
