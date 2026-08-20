import { eq } from 'drizzle-orm';
import type { Onboarding } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Onboarding — `onboarding` table data access (docs/onboarding-generator-plan.md
 * Work Item 6). The ONLY file in this module allowed to import `drizzle-orm`.
 * One row per repo — `upsert` always replaces the existing row in place
 * (upsert on `repo_id`, the table's own PK), never inserts a second row or
 * keeps history (spec §9's "deliberately different from `blast_summaries`"
 * lifecycle note).
 */

export type OnboardingRow = typeof t.onboarding.$inferSelect;

export interface UpsertOnboardingInput {
  json: Onboarding;
  indexedSha: string | null;
  fileCount: number | null;
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
}

export class OnboardingRepository {
  constructor(private db: Db) {}

  async getByRepoId(repoId: string): Promise<OnboardingRow | undefined> {
    const [row] = await this.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repoId));
    return row;
  }

  async upsert(repoId: string, input: UpsertOnboardingInput): Promise<OnboardingRow> {
    const [row] = await this.db
      .insert(t.onboarding)
      .values({
        repoId,
        json: input.json,
        generatedAt: new Date(),
        indexedSha: input.indexedSha,
        fileCount: input.fileCount,
        provider: input.provider,
        model: input.model,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        costUsd: input.costUsd === null ? null : String(input.costUsd),
      })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: {
          json: input.json,
          generatedAt: new Date(),
          indexedSha: input.indexedSha,
          fileCount: input.fileCount,
          provider: input.provider,
          model: input.model,
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
          costUsd: input.costUsd === null ? null : String(input.costUsd),
        },
      })
      .returning();
    return row!;
  }
}
