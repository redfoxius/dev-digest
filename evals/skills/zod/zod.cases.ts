import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// threshold: 0.6, not 0.7, on every 3-practice case below — with 3 practices the only achievable
// scores are 0, 0.667, and 1.0, and 0.7 sits between 0.667 and 1.0, so catching 2 of 3 real issues
// (a good review) always fails. Live CI on DeepSeek hit exactly this: a flaky 2/3 miss on a
// legitimate practice. 0.6 tolerates one miss without passing a 1/3 or 0/3 review.

// Migrated from the legacy .claude/skills/zod/evals/evals.json (run via scripts/run-skill-evals.mjs
// + .github/workflows/skill-evals.yml). Same three fixtures and expectations, ported to this
// package's SkillCase/practices shape.
const REVIEW_PROMPT = (file: string) =>
  `Review the following Zod schema/validation TypeScript file for best-practice issues. List each ` +
  `issue found with: file:line, a short description of the problem, and a suggested fix. Do not ` +
  `rewrite the file — only report findings as a numbered list.\n\n\`\`\`typescript\n${fx(file)}\`\`\``;

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
    threshold: 0.6,
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
  {
    name: "registration schema: missing .email(), z.any() metadata, unguarded parse() on raw input",
    kind: "quality",
    prompt: REVIEW_PROMPT("registration-api.ts"),
    practices: [
      "flags `email: z.string()` as missing `.email()` validation (schema-string-validations)",
      "flags `metadata: z.any()` as unsafe and recommends `z.unknown()` instead (schema-use-unknown-not-any)",
      "flags `registerSchema.parse(rawBody)` as unsafe on untrusted/raw request input and recommends `safeParse()` (parse-use-safeparse)",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
  {
    name: "product patch: hand-duplicated update schema, duplicated interface, unvalidated JSON.parse",
    kind: "quality",
    prompt: REVIEW_PROMPT("product-patch.ts"),
    practices: [
      "flags `productUpdateSchema` as a hand-duplicated copy of `productSchema` and recommends `productSchema.partial()` (object-partial-for-updates)",
      "flags `interface ProductUpdateInput` as duplicating the schema shape and recommends `z.infer<typeof productUpdateSchema>` instead (type-use-z-infer)",
      "flags `JSON.parse(rawJson)` followed by an `as ProductUpdateInput` cast as unvalidated/untrusted data that never passes through a zod schema (parse-never-trust-json)",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
  {
    name: "search query: missing coercion, schema rebuilt per call, refine() missing a path",
    kind: "quality",
    prompt: REVIEW_PROMPT("search-query.ts"),
    practices: [
      "flags `page`/`limit`/`minPrice`/`maxPrice` as `z.number()` fed from string query params and recommends `z.coerce.number()` (schema-coercion-for-form-data)",
      "flags `querySchema` being constructed fresh inside `searchProducts` on every call and recommends hoisting it to module scope (perf-cache-schemas / perf-avoid-dynamic-creation)",
      "flags the `.refine()` cross-field check (minPrice <= maxPrice) as missing a `path`, so the error can't be attributed to a specific field (refine-add-path)",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
