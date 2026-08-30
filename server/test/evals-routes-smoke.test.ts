import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

/**
 * No-DB route-table smoke test (mirrors `routes-smoke.test.ts`'s convention)
 * confirming the new `evals` module (`specs/cross-cutting/eval-pipeline/plan.md`
 * Work Item 8) registers all 7 routes into Fastify's route table. `app.ready()`
 * builds the whole plugin/route tree without ever executing a handler (no DB
 * connection needed — `postgres-js` connects lazily), so `app.hasRoute` alone
 * is enough to prove every path from spec §10 is reachable.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('evals routes (no DB) — route table', () => {
  it('registers all 7 new evals routes', async () => {
    const app = await buildApp({ config });
    await app.ready();

    const expected: Array<{ method: string; url: string }> = [
      { method: 'POST', url: '/findings/:id/eval-case' },
      { method: 'GET', url: '/agents/:id/eval-cases' },
      { method: 'POST', url: '/agents/:id/eval-cases' },
      { method: 'PUT', url: '/agents/:id/eval-cases/:caseId' },
      { method: 'DELETE', url: '/agents/:id/eval-cases/:caseId' },
      { method: 'POST', url: '/agents/:id/eval-cases/:caseId/run' },
      { method: 'POST', url: '/agents/:id/eval-runs' },
      { method: 'GET', url: '/agents/:id/eval-dashboard' },
    ];

    for (const route of expected) {
      expect(app.hasRoute(route), `expected route ${route.method} ${route.url} to be registered`).toBe(true);
    }

    await app.close();
  });
});
