import { eq } from 'drizzle-orm';
import type { RiskBrief } from '@devdigest/shared';
import { RiskBrief as RiskBriefSchema } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Risk Brief — `pr_brief` table data access
 * (`specs/cross-cutting/pr-why-risk-brief/plan.md` Work Item 4, spec §9).
 * The ONLY file in this module allowed to import `drizzle-orm`. Reuses the
 * existing, empty `pr_brief` table (`server/src/db/schema/reviews.ts:140-145`,
 * `{pr_id uuid PK/FK cascade, json jsonb NOT NULL}`, shipped in
 * `0000_init.sql`) — no new table, no migration. One row per PR, always
 * overwritten in place (`upsert`/`onConflictDoUpdate` on `pr_id`), never
 * superseded by a second row.
 */
export class RiskBriefRepository {
  constructor(private db: Db) {}

  /**
   * The `json` column is opaque `jsonb` — it round-trips as `unknown`, so
   * every read re-validates via `RiskBrief.parse` (never trust a stored blob
   * without re-checking its shape, e.g. after a contract change or a
   * legacy/malformed write). A malformed `json` value throws a clear zod
   * parse error here rather than silently resolving to `undefined` — the
   * caller must not confuse "no brief yet" with "a brief exists but is
   * corrupt".
   */
  async getByPrId(prId: string): Promise<RiskBrief | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    if (!row) return undefined;
    return RiskBriefSchema.parse(row.json);
  }

  /** Insert-or-overwrite the persisted brief for `prId` — the table's own PK
   *  (`prBrief.prId`) is the conflict target, so this always leaves exactly
   *  one row per PR (spec §9 lifecycle: "overwritten in place"). */
  async upsert(prId: string, brief: RiskBrief): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: brief })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: brief } });
  }
}
