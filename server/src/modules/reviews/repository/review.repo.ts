import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Finding } from '@devdigest/shared';
import type { FindingRow, PullRow } from '../../../db/rows.js';

export type ReviewRow = typeof t.reviews.$inferSelect;

// ---- reviews + findings ---------------------------------------------------

export async function insertReview(
  db: Db,
  values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    runId: string | null;
    kind: 'summary' | 'review';
    verdict: string | null;
    summary: string | null;
    score: number | null;
    /** USD cost of the run that produced this review; null when unknown. */
    costUsd: number | null;
    model: string | null;
  },
): Promise<ReviewRow> {
  const [row] = await db.insert(t.reviews).values(values).returning();
  return row!;
}

export async function insertFindings(
  db: Db,
  reviewId: string,
  findings: Finding[],
): Promise<FindingRow[]> {
  if (findings.length === 0) return [];
  const rows = await db
    .insert(t.findings)
    .values(
      findings.map((f) => ({
        reviewId,
        file: f.file,
        startLine: f.start_line,
        endLine: f.end_line,
        severity: f.severity,
        category: f.category,
        title: f.title,
        rationale: f.rationale,
        suggestion: f.suggestion ?? null,
        confidence: f.confidence,
        kind: f.kind ?? 'finding',
        trifectaComponents: f.trifecta_components ?? null,
        // Intent Layer — set by the reviewing LLM itself only when intent was
        // injected into its prompt; null otherwise (`f.in_scope` is `.nullish()`).
        inScope: f.in_scope ?? null,
      })),
    )
    .returning();
  return rows;
}

/** Reviews for a PR (newest first), each with its findings. */
export async function reviewsForPull(
  db: Db,
  prId: string,
): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
  const reviews = await db
    .select()
    .from(t.reviews)
    .where(eq(t.reviews.prId, prId))
    .orderBy(desc(t.reviews.createdAt));
  if (reviews.length === 0) return [];
  const ids = reviews.map((r) => r.id);
  const findings = await db.select().from(t.findings).where(inArray(t.findings.reviewId, ids));
  return reviews.map((review) => ({
    review,
    findings: findings.filter((f) => f.reviewId === review.id),
  }));
}

/**
 * Findings from the PR's LATEST review batch only — one `POST /pulls/:id/review`
 * action may fan out to several agents sharing `agent_runs.multi_agent_run_id`
 * (a batch), not a single review row. Re-derives the same batch-key algorithm
 * already inlined in `pulls/routes.ts` (`batchKey = review.runId →
 * agentRuns.multiAgentRunId ?? review.id`; rows ordered newest-first; the
 * first batch key seen pins "the latest batch"), scoped to one `prId` instead
 * of the bulk multi-PR list version — used by Smart Diff (Phase 2) to badge
 * finding lines without duplicating that computation. Excludes dismissed
 * findings (`dismissed_at IS NULL`); an accepted-but-not-dismissed finding is
 * still included (accepted ≠ resolved). Empty array before any review has run.
 */
export async function getLatestReviewBatchFindings(db: Db, prId: string): Promise<FindingRow[]> {
  const reviewRows = await db
    .select({
      id: t.reviews.id,
      runId: t.reviews.runId,
      multiAgentRunId: t.agentRuns.multiAgentRunId,
    })
    .from(t.reviews)
    .leftJoin(t.agentRuns, eq(t.reviews.runId, t.agentRuns.id))
    .where(and(eq(t.reviews.prId, prId), eq(t.reviews.kind, 'review')))
    .orderBy(desc(t.reviews.createdAt));

  let latestBatchKey: string | undefined;
  const latestReviewIds: string[] = [];
  for (const rv of reviewRows) {
    const batchKey = rv.runId ? (rv.multiAgentRunId ?? rv.runId) : rv.id;
    if (latestBatchKey === undefined) latestBatchKey = batchKey;
    if (batchKey === latestBatchKey) latestReviewIds.push(rv.id);
  }
  if (latestReviewIds.length === 0) return [];

  return db
    .select()
    .from(t.findings)
    .where(and(inArray(t.findings.reviewId, latestReviewIds), isNull(t.findings.dismissedAt)));
}

export async function getReview(db: Db, reviewId: string): Promise<ReviewRow | undefined> {
  const [row] = await db.select().from(t.reviews).where(eq(t.reviews.id, reviewId));
  return row;
}

/** Delete a whole review (one agent's run) + its findings (cascade), scoped
 *  to the workspace. Returns false if not found in the workspace. */
export async function deleteReview(
  db: Db,
  workspaceId: string,
  reviewId: string,
): Promise<boolean> {
  const rows = await db
    .delete(t.reviews)
    .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.id, reviewId)))
    .returning({ id: t.reviews.id });
  return rows.length > 0;
}

// ---- finding actions ------------------------------------------------------

export async function getFinding(db: Db, findingId: string): Promise<FindingRow | undefined> {
  const [row] = await db.select().from(t.findings).where(eq(t.findings.id, findingId));
  return row;
}

/** Resolve workspace_id + pr_id for a finding (via review → pr). */
export async function findingContext(
  db: Db,
  findingId: string,
): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
  const finding = await getFinding(db, findingId);
  if (!finding) return undefined;
  const review = await getReview(db, finding.reviewId);
  if (!review) return undefined;
  const [pull] = await db
    .select()
    .from(t.pullRequests)
    .where(eq(t.pullRequests.id, review.prId));
  if (!pull) return undefined;
  return { finding, review, pull };
}

export async function setFindingAccepted(
  db: Db,
  findingId: string,
  at: Date | null,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .update(t.findings)
    .set({ acceptedAt: at, dismissedAt: null })
    .where(eq(t.findings.id, findingId))
    .returning();
  return row;
}

export async function setFindingDismissed(
  db: Db,
  findingId: string,
  at: Date | null,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .update(t.findings)
    .set({ dismissedAt: at, acceptedAt: null })
    .where(eq(t.findings.id, findingId))
    .returning();
  return row;
}
