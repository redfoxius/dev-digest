/**
 * `RiskBriefRepository` unit tests (`specs/cross-cutting/pr-why-risk-brief/plan.md`
 * Work Item 4) — a fake `Db` chain (mirrors `test/onboarding.test.ts`'s
 * `makeFakeDb`) drives `getByPrId`/`upsert` with no Postgres involved.
 */
import { describe, it, expect } from 'vitest';
import type { Db } from '../src/db/client.js';
import type { RiskBrief } from '@devdigest/shared';
import { RiskBriefRepository } from '../src/modules/risk-brief/repository.js';

const PR_ID = 'pr-1';

const validBrief: RiskBrief = {
  what: 'Adds a new endpoint.',
  why: 'Reduces manual reviewer effort.',
  risk_level: 'medium',
  risks: [],
  review_focus: [],
  pr_head_sha: 'abc123',
  provider: 'openai',
  model: 'gpt-4.1',
  generated_at: '2026-08-20T00:00:00.000Z',
};

// ---- fake Db (mirrors test/onboarding.test.ts's makeFakeDb) ---------------

interface FakeCall {
  op: 'select' | 'insert';
  table?: unknown;
  payload?: unknown;
}

function makeFakeDb(selectQueue: unknown[]): { db: Db; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let i = 0;
  function nextSelectResult(): unknown {
    if (i >= selectQueue.length) {
      throw new Error(`makeFakeDb: no queued select result for call #${i} (queue has ${selectQueue.length})`);
    }
    return selectQueue[i++];
  }
  function selectChain(call: FakeCall) {
    const c = {
      from(table: unknown) {
        call.table ??= table;
        return c;
      },
      where() {
        return c;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        try {
          resolve(nextSelectResult());
        } catch (err) {
          if (reject) reject(err);
          else throw err;
        }
      },
    };
    return c;
  }
  function insertChain(call: FakeCall) {
    const c = {
      values(payload: unknown) {
        call.payload = payload;
        return c;
      },
      onConflictDoUpdate() {
        return c;
      },
      returning() {
        return c;
      },
      then(resolve: (v: unknown) => void) {
        resolve([call.payload]);
      },
    };
    return c;
  }
  const db = {
    select: () => {
      const call: FakeCall = { op: 'select' };
      calls.push(call);
      return selectChain(call);
    },
    insert: () => {
      const call: FakeCall = { op: 'insert' };
      calls.push(call);
      return insertChain(call);
    },
  } as unknown as Db;
  return { db, calls };
}

describe('RiskBriefRepository', () => {
  it('getByPrId returns undefined when no row exists', async () => {
    const { db } = makeFakeDb([[]]);
    const repo = new RiskBriefRepository(db);
    await expect(repo.getByPrId(PR_ID)).resolves.toBeUndefined();
  });

  it('getByPrId round-trips a stored RiskBrief (jsonb round-trips as unknown, re-validated on read)', async () => {
    const { db } = makeFakeDb([[{ prId: PR_ID, json: validBrief }]]);
    const repo = new RiskBriefRepository(db);
    await expect(repo.getByPrId(PR_ID)).resolves.toEqual(validBrief);
  });

  it('getByPrId throws a clear parse error on malformed/legacy json, not a silent undefined', async () => {
    const { db } = makeFakeDb([[{ prId: PR_ID, json: { not: 'a risk brief' } }]]);
    const repo = new RiskBriefRepository(db);
    await expect(repo.getByPrId(PR_ID)).rejects.toThrow();
  });

  it('upsert inserts into prBrief with an onConflictDoUpdate targeting prId', async () => {
    const { db, calls } = makeFakeDb([]);
    const repo = new RiskBriefRepository(db);
    await repo.upsert(PR_ID, validBrief);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe('insert');
    expect(calls[0]!.payload).toEqual({ prId: PR_ID, json: validBrief });
  });
});
