import { describe, it, expect, vi } from 'vitest';
import { JobRunner } from '../src/platform/jobs.js';
import type { Db } from '../src/db/client.js';

/**
 * Minimal fake `Db` — just enough chain surface for JobRunner's own
 * `insert(...).values(...).returning(...)` / `update(...).set(...).where(...)`
 * calls, no real Postgres needed.
 */
function fakeDb(): Db {
  const chain = {
    values: () => chain,
    set: () => chain,
    where: () => chain,
    returning: () => [{ id: 'job-1' }],
  };
  return { insert: () => chain, update: () => chain } as unknown as Db;
}

describe('JobRunner — fire-and-forget enqueue', () => {
  it('records a failing job as status=failed without crashing the process via an unhandled rejection', async () => {
    const runner = new JobRunner(fakeDb(), { retries: 0 });
    runner.register('clone', async () => {
      throw new Error('repository not found');
    });

    const onUnhandledRejection = vi.fn();
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      // Real callers (RepoService.add/refresh) only `await enqueue()` itself
      // and never touch the returned `done` promise — this mirrors that.
      await runner.enqueue('ws-1', 'clone', {});
      await runner.onIdle();
      // Node schedules the unhandledRejection check on a later microtask/tick.
      await new Promise((resolve) => setImmediate(resolve));
      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('the returned `done` promise still rejects for a caller that does await it', async () => {
    const runner = new JobRunner(fakeDb(), { retries: 0 });
    runner.register('clone', async () => {
      throw new Error('repository not found');
    });
    const { done } = await runner.enqueue('ws-1', 'clone', {});
    await expect(done).rejects.toThrow('repository not found');
  });
});
