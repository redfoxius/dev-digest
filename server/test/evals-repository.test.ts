/**
 * `EvalsRepository` — unit, no Docker
 * (`specs/cross-cutting/eval-pipeline/plan.md` Work Item 2, spec §9).
 *
 * No implementer-authored test exists for this file specifically —
 * `evals-service.test.ts` only exercises it indirectly through a
 * queue-based fake `Db`. This file targets `repository.ts` directly, with
 * the same `makeFakeDb` convention (`test/skills.test.ts`'s pattern, cited
 * in `server/INSIGHTS.md`'s 2026-08-09 entry), plus one extra trick: the
 * `.where()`/`.values()` arguments captured by the fake chain are REAL
 * `drizzle-orm` `eq`/`and`/`inArray` SQL AST objects (this test never mocks
 * `drizzle-orm` itself) — `JSON.stringify`-ing one of them reliably surfaces
 * both the referenced column name and the literal bound value in its
 * `queryChunks` array (confirmed by direct inspection: `eq(col, 'x')` ->
 * `{..., queryChunks: [..., {name: 'workspace_id'}, ..., 'x', ...]}`), which
 * is what every workspace-scoping assertion below relies on instead of a
 * real Postgres round trip.
 */
import { describe, it, expect } from 'vitest';
import type { Db } from '../src/db/client.js';
import { EvalsRepository, type InsertEvalRun } from '../src/modules/evals/repository.js';

const WS = 'ws-1';
const OTHER_WS = 'ws-2';
const AGENT_ID = 'agent-1';
const CASE_ID = 'case-1';

// ---- fake Db (mirrors test/skills.test.ts's makeFakeDb, plus capturing the
// where()/values() arguments so this file can assert on the REAL drizzle-orm
// SQL AST built from them, not just call counts) -------------------------

interface FakeCall {
  op: 'select' | 'insert' | 'update' | 'delete';
  where?: unknown[];
  values?: unknown;
  set?: unknown;
}

function makeFakeDb(queue: unknown[]): { db: Db; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let i = 0;

  function nextResult(): unknown {
    if (i >= queue.length) {
      throw new Error(`makeFakeDb: no queued result for call #${i} (queue has ${queue.length})`);
    }
    return queue[i++];
  }

  function chain(call: FakeCall) {
    const c = {
      from() {
        return c;
      },
      where(cond: unknown) {
        (call.where ??= []).push(cond);
        return c;
      },
      values(payload: unknown) {
        call.values = payload;
        return c;
      },
      set(payload: unknown) {
        call.set = payload;
        return c;
      },
      returning(shape?: unknown) {
        void shape;
        return c;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        try {
          resolve(nextResult());
        } catch (err) {
          if (reject) reject(err);
          else throw err;
        }
      },
    };
    return c;
  }

  const db = {
    select: () => {
      const call: FakeCall = { op: 'select' };
      calls.push(call);
      return chain(call);
    },
    insert: () => {
      const call: FakeCall = { op: 'insert' };
      calls.push(call);
      return chain(call);
    },
    update: () => {
      const call: FakeCall = { op: 'update' };
      calls.push(call);
      return chain(call);
    },
    delete: () => {
      const call: FakeCall = { op: 'delete' };
      calls.push(call);
      return chain(call);
    },
    transaction: (fn: (tx: Db) => Promise<unknown>) => fn(db),
  } as unknown as Db;

  return { db, calls };
}

/** Circular-safe stringify — a real drizzle-orm `Column` object's `table`
 *  property points back at the table, which itself holds every column
 *  (including the one being serialized), so a plain `JSON.stringify` throws
 *  "Converting circular structure to JSON". Substituting `'[Circular]'` for
 *  any already-seen object keeps the column `name`/bound-value chunks this
 *  file's assertions rely on intact. */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  });
}

/** Every `.where(cond)` arg is a real drizzle-orm SQL object — stringify it
 *  and assert both the column name and the literal value appear, per this
 *  file's header comment. */
function whereContains(call: FakeCall | undefined, ...needles: string[]): void {
  expect(call?.where?.length, 'expected exactly one .where() call').toBe(1);
  const rendered = safeStringify(call!.where![0]);
  for (const needle of needles) {
    expect(rendered, `expected .where() clause to reference "${needle}"`).toContain(needle);
  }
}

const evalCaseRow = (overrides: Record<string, unknown> = {}) => ({
  id: CASE_ID,
  workspaceId: WS,
  ownerKind: 'agent',
  ownerId: AGENT_ID,
  name: 'A case',
  inputDiff: 'diff text',
  inputFiles: null,
  inputMeta: null,
  expectedOutput: { expectations: [] },
  notes: null,
  ...overrides,
});

// ==========================================================================
// Workspace scoping — every read/write method (spec AC-9/AC-24/AC-38)
// ==========================================================================

describe('EvalsRepository — workspace scoping', () => {
  it('listCases scopes to workspace_id + owner_kind=agent + owner_id', async () => {
    const { db, calls } = makeFakeDb([[evalCaseRow()]]);
    const repo = new EvalsRepository(db);

    await repo.listCases(WS, AGENT_ID);

    whereContains(calls[0], 'workspace_id', WS, 'owner_id', AGENT_ID, 'owner_kind', 'agent');
  });

  it('getCase scopes to workspace_id + id — a case from another workspace never resolves', async () => {
    const { db, calls } = makeFakeDb([[]]);
    const repo = new EvalsRepository(db);

    const result = await repo.getCase(OTHER_WS, CASE_ID);

    expect(result).toBeUndefined();
    whereContains(calls[0], 'workspace_id', OTHER_WS, CASE_ID);
  });

  it('updateCase scopes its WHERE to workspace_id + id (a cross-workspace update matches nothing)', async () => {
    const { db, calls } = makeFakeDb([[evalCaseRow({ name: 'Renamed' })]]);
    const repo = new EvalsRepository(db);

    await repo.updateCase(WS, CASE_ID, { name: 'Renamed' });

    whereContains(calls[0], 'workspace_id', WS, CASE_ID);
    expect(calls[0]?.set).toEqual({ name: 'Renamed' });
  });

  it('updateCase only sets the fields present in the patch, leaving the rest untouched', async () => {
    const { db, calls } = makeFakeDb([[evalCaseRow()]]);
    const repo = new EvalsRepository(db);

    await repo.updateCase(WS, CASE_ID, { notes: 'a note' });

    expect(calls[0]?.set).toEqual({ notes: 'a note' });
  });

  it('deleteCase scopes its WHERE to workspace_id + id', async () => {
    const { db, calls } = makeFakeDb([[{ id: CASE_ID }]]);
    const repo = new EvalsRepository(db);

    const ok = await repo.deleteCase(WS, CASE_ID);

    expect(ok).toBe(true);
    whereContains(calls[0], 'workspace_id', WS, CASE_ID);
  });
});

// ==========================================================================
// updateCase — empty-patch short-circuit (pr-self-review fix 3,
// drizzle-orm-patterns skill): a patch with zero own keys (every field
// `undefined`, e.g. a client PUT-ing `{}`) must never reach `.update().set({})`
// — Drizzle throws on an empty `.set()` payload. Instead it fetches and
// returns the current row via `getCase`, matching `insertRunBatch`/
// `listRunsByCaseIds`'s existing empty-input short-circuit style in this file.
// ==========================================================================

describe('EvalsRepository.updateCase — empty-patch short-circuit', () => {
  it('returns the current row via getCase and never calls .update() when the patch has zero keys', async () => {
    const { db, calls } = makeFakeDb([[evalCaseRow()]]); // only getCase's own select is queued

    const repo = new EvalsRepository(db);
    const result = await repo.updateCase(WS, CASE_ID, {});

    expect(result).toEqual(evalCaseRow());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.op).toBe('select');
  });
});

// ==========================================================================
// deleteCase — relies entirely on the existing eval_runs.case_id ON DELETE
// CASCADE (AC-8); no manual eval_runs cleanup query is issued.
// ==========================================================================

describe('EvalsRepository.deleteCase — no manual cascade query', () => {
  it('issues exactly one DELETE and no additional query against eval_runs', async () => {
    const { db, calls } = makeFakeDb([[{ id: CASE_ID }]]);
    const repo = new EvalsRepository(db);

    await repo.deleteCase(WS, CASE_ID);

    // Exactly one DB call total — the DELETE on eval_cases itself. No
    // second call (select/delete) targeting eval_runs, because the FK's
    // ON DELETE CASCADE (db/schema/eval.ts:24-26) already handles it.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.op).toBe('delete');
  });

  it('returns false (no case deleted) when nothing matched — no cascade side effect either', async () => {
    const { db, calls } = makeFakeDb([[]]);
    const repo = new EvalsRepository(db);

    const ok = await repo.deleteCase(WS, 'nonexistent-case');

    expect(ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

// ==========================================================================
// insertRunBatch — the mechanism the whole feature's "batch grouping via
// shared ran_at" depends on: ONE multi-row INSERT inside ONE transaction,
// never N separate per-case inserts (spec §5/§9/AC-12/AC-21).
// ==========================================================================

describe('EvalsRepository.insertRunBatch', () => {
  it('issues exactly ONE .values([...]) call with all N rows, not N separate inserts', async () => {
    const returned = [{ id: 'run-1' }, { id: 'run-2' }, { id: 'run-3' }];
    const { db, calls } = makeFakeDb([returned]);
    const repo = new EvalsRepository(db);

    const rows: InsertEvalRun[] = [
      { caseId: 'case-1', pass: true, recall: 1, precision: 1, citationAccuracy: 1 },
      { caseId: 'case-2', pass: false, recall: 0, precision: 1, citationAccuracy: 1 },
      { caseId: 'case-3', pass: true, recall: 1, precision: 0.5, citationAccuracy: 1 },
    ];

    const result = await repo.insertRunBatch(rows);

    expect(result).toEqual(returned);
    // Exactly one insert() call for the whole batch...
    const insertCalls = calls.filter((c) => c.op === 'insert');
    expect(insertCalls).toHaveLength(1);
    // ...and its .values() payload is the FULL array of all 3 rows in one
    // call, not one row per call (the load-bearing shared-ran_at mechanism).
    expect(Array.isArray(insertCalls[0]?.values)).toBe(true);
    expect((insertCalls[0]?.values as unknown[]).length).toBe(3);
    expect((insertCalls[0]?.values as { caseId: string }[]).map((r) => r.caseId)).toEqual([
      'case-1',
      'case-2',
      'case-3',
    ]);
  });

  it('returns [] and opens no transaction/query at all for a zero-row batch (AC-15)', async () => {
    const { db, calls } = makeFakeDb([]); // empty queue — any real query would throw "no queued result"
    const repo = new EvalsRepository(db);

    const result = await repo.insertRunBatch([]);

    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// ==========================================================================
// listRunsByCaseIds
// ==========================================================================

describe('EvalsRepository.listRunsByCaseIds', () => {
  it('scopes to the given case ids via IN', async () => {
    const rows = [{ id: 'run-1', caseId: 'case-1' }];
    const { db, calls } = makeFakeDb([rows]);
    const repo = new EvalsRepository(db);

    const result = await repo.listRunsByCaseIds(['case-1', 'case-2']);

    expect(result).toEqual(rows);
    whereContains(calls[0], 'case_id', 'case-1', 'case-2');
  });

  it('returns [] and issues no query for an empty case-id list', async () => {
    const { db, calls } = makeFakeDb([]);
    const repo = new EvalsRepository(db);

    const result = await repo.listRunsByCaseIds([]);

    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// ==========================================================================
// insertCase — owner_kind is always 'agent', values map correctly
// ==========================================================================

describe('EvalsRepository.insertCase', () => {
  it('always writes owner_kind: "agent" regardless of any other input', async () => {
    const { db, calls } = makeFakeDb([[evalCaseRow()]]);
    const repo = new EvalsRepository(db);

    await repo.insertCase({
      workspaceId: WS,
      ownerId: AGENT_ID,
      name: 'New case',
      inputDiff: 'diff',
      expectedOutput: { expectations: [] },
    });

    const insertCall = calls.find((c) => c.op === 'insert');
    expect((insertCall?.values as { ownerKind: string }).ownerKind).toBe('agent');
    expect((insertCall?.values as { workspaceId: string }).workspaceId).toBe(WS);
  });
});
