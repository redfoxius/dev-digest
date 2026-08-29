import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Evals data-access — owns `eval_cases`/`eval_runs`
 * (`specs/cross-cutting/eval-pipeline/plan.md` Work Item 2, spec §9). Both
 * tables already exist, shipped empty — no new schema/migration here. The
 * ONLY file in the `evals` module allowed to import `drizzle-orm`/
 * `../../db/schema.js`.
 *
 * `eval_cases.workspace_id` exists directly, so every case query filters it
 * inline. `eval_runs` has NO `workspace_id` column — `listRunsByCaseIds`
 * intentionally takes already-workspace-scoped case ids (the caller resolves
 * them via `listCases`/`getCase` first) rather than re-deriving a
 * `case_id IN (SELECT ... WHERE workspace_id = ...)` subquery here; that
 * keeps workspace scoping enforced in exactly one place per read path.
 *
 * This spec only ever writes `owner_kind: 'agent'` — `'skill'`-owned cases
 * are schema-supported but out of scope (spec §12).
 */

import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';
export type { EvalCaseRow, EvalRunRow };

export interface InsertEvalCase {
  workspaceId: string;
  ownerId: string;
  name: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

/** One trace to persist from a run batch (single case or the whole set). */
export interface InsertEvalRun {
  caseId: string;
  actualOutput?: unknown;
  pass?: boolean | null;
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
}

export class EvalsRepository {
  constructor(private db: Db) {}

  /** Every case owned by `ownerId` (always `owner_kind: 'agent'`, spec §12),
   *  scoped to the caller's workspace (AC-9). */
  async listCases(workspaceId: string, ownerId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
  }

  /** One case, workspace-scoped — `undefined` if it doesn't exist or belongs
   *  to another workspace (AC-4/AC-24). */
  async getCase(workspaceId: string, caseId: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)));
    return row;
  }

  async insertCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: 'agent',
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff ?? null,
        inputFiles: (values.inputFiles as object | undefined) ?? null,
        inputMeta: (values.inputMeta as object | undefined) ?? null,
        expectedOutput: (values.expectedOutput as object | undefined) ?? null,
        notes: values.notes ?? null,
      })
      .returning();
    return row!;
  }

  /** Update editable fields, workspace-scoped — `undefined` if the case
   *  doesn't exist or isn't in this workspace (AC-7). */
  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles as object } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta as object } : {}),
        ...(patch.expectedOutput !== undefined
          ? { expectedOutput: patch.expectedOutput as object }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning();
    return row;
  }

  /** Delete one case, workspace-scoped. Its `eval_runs` history cascades via
   *  the already-existing `eval_runs.case_id` `ON DELETE CASCADE`
   *  (`db/schema/eval.ts:24-26`) — no manual cleanup here (AC-8). */
  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /**
   * Insert every trace from one run (single case or the whole set) in ONE
   * multi-row INSERT inside ONE transaction — a single statement, so every
   * row's `defaultNow()` `ran_at` is identical by Postgres semantics. This is
   * the mechanism the dashboard later uses to group N cases' traces back
   * into "one batch" with no new schema column (spec §5/§9/AC-12/AC-21).
   * Never call `.insert().values(row)` per case in a loop.
   *
   * Zero-row short-circuit (AC-15): an agent with no cases must insert
   * nothing — an empty multi-row `.values([])` call is invalid, so this
   * returns `[]` without opening a transaction at all.
   */
  async insertRunBatch(rows: InsertEvalRun[]): Promise<EvalRunRow[]> {
    if (rows.length === 0) return [];
    return this.db.transaction((tx) =>
      tx
        .insert(t.evalRuns)
        .values(
          rows.map((r) => ({
            caseId: r.caseId,
            actualOutput: (r.actualOutput as object | undefined) ?? null,
            pass: r.pass ?? null,
            recall: r.recall ?? null,
            precision: r.precision ?? null,
            citationAccuracy: r.citationAccuracy ?? null,
            durationMs: r.durationMs ?? null,
            costUsd: r.costUsd ?? null,
          })),
        )
        .returning(),
    );
  }

  /** Every trace for a set of cases — for dashboard assembly (a later Work
   *  Item). Callers scope `caseIds` to the caller's workspace themselves
   *  (typically via `listCases`), since `eval_runs` carries no
   *  `workspace_id` of its own. */
  async listRunsByCaseIds(caseIds: string[]): Promise<EvalRunRow[]> {
    if (caseIds.length === 0) return [];
    return this.db.select().from(t.evalRuns).where(inArray(t.evalRuns.caseId, caseIds));
  }
}
