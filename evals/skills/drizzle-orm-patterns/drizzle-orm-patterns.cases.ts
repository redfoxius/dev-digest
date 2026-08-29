import type { SkillCase } from "../../src/index.js";

const SCHEMA_SNIPPET = `\`\`\`typescript
import { pgTable, serial, text, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  managerId: integer('manager_id').references(users.id),
  name: text('name').notNull(),
});

export async function transferBalance(tx: any, fromId: number, toId: number, amount: number) {
  const [from] = await tx.select().from(accounts).where(eq(accounts.userId, fromId));
  if (from.balance < amount) {
    tx.rollback();
  }
  await tx.update(accounts).set({ balance: from.balance - amount }).where(eq(accounts.userId, fromId));
}
\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "flags a self-referencing FK defined without an arrow function",
    kind: "quality",
    prompt: `Review this Drizzle schema and transaction helper for correctness issues.\n\n${SCHEMA_SNIPPET}`,
    // Dropped a third practice that used to live here ("does not claim .returning() is
    // universally supported...") — .returning() is never mentioned in SCHEMA_SNIPPET or the
    // prompt, so it's an absence-of-a-claim check with nothing to react to. llmJudge only PASSes
    // on a verbatim quote as evidence (src/scoring/llm-judge.ts); there is no quote that can prove
    // a negative about something never discussed, so this practice was unwinnable regardless of
    // model quality — it wasn't measuring anything real.
    practices: [
      "the review flags managerId's self-reference (references(users.id)) as needing an arrow function (references(() => users.id)) to avoid the circular-dependency issue, not just silence on this line",
      "the review notes that tx.rollback() throws an exception, so the transferBalance function needs a try/catch around the transaction call site or it will propagate as an unhandled rejection",
    ],
    threshold: 0.65,
    maxTurns: 8,
  },
  {
    name: "recommends $inferSelect/$inferInsert over hand-written types",
    kind: "quality",
    prompt:
      "I defined a Drizzle `users` table with pgTable, and now I'm about to write a separate " +
      "TypeScript interface by hand (`interface User { id: number; name: string; }`) to use as the " +
      "return type for my query functions. Is that the right approach?",
    practices: [
      "the answer recommends using typeof users.$inferSelect (and $inferInsert for inserts) instead of a hand-written interface",
      "the answer explains the risk of a hand-written type drifting out of sync with the actual schema",
      "the answer does not endorse the hand-written interface as an equally good alternative",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
];
