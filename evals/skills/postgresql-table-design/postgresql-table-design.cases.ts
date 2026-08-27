import type { SkillCase } from "../../src/index.js";

const SCHEMA_SNIPPET = `\`\`\`sql
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  status VARCHAR(20) NOT NULL,
  total MONEY NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "flags every disallowed data type in one schema and recommends the correct replacement",
    kind: "quality",
    prompt: `Review this PostgreSQL table design.\n\n${SCHEMA_SNIPPET}`,
    practices: [
      "the review flags SERIAL and recommends GENERATED ALWAYS AS IDENTITY instead",
      "the review flags VARCHAR(20) and recommends TEXT (optionally with a CHECK(LENGTH(...)) constraint) instead",
      "the review flags MONEY and recommends NUMERIC instead",
      "the review flags TIMESTAMP (without time zone) and recommends TIMESTAMPTZ instead",
      "the review flags the missing index on the user_id foreign key column, noting Postgres does not auto-index FK columns",
    ],
    threshold: 0.7,
    maxTurns: 8,
  },
  {
    name: "recommends GIN over B-tree for JSONB containment queries",
    kind: "quality",
    prompt:
      "I have a `profiles` table with a JSONB `attrs` column, and I mostly query it with " +
      "`attrs @> '{\"plan\": \"pro\"}'`-style containment checks. Should I add a plain B-tree index on " +
      "the column?",
    practices: [
      "the answer recommends a GIN index on the JSONB column instead of a B-tree index for containment queries",
      "the answer does not recommend a plain B-tree index as sufficient for @> containment queries on a JSONB column",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
];
