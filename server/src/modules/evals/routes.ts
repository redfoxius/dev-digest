import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalRunResult } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalsService } from './service.js';

/** `/agents/:id/eval-cases/:caseId[...]` — both uuids. */
const EvalCaseParams = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
});

/**
 * Manual eval-case create body (`POST /agents/:id/eval-cases`) — mirrors
 * `EvalsService`'s own `CreateEvalCaseInput` shape exactly. `expected_output`
 * stays `z.unknown()` here (route-level) — the inner
 * `{ expectations: EvalExpectation[] }` shape is validated INSIDE the service
 * via `EvalCaseExpectedOutput.safeParse` (AC-10, `zod` skill's two-layer
 * validation convention), converting a failure into a 422 `ValidationError`.
 * `owner_kind`/`owner_id` are deliberately absent — always derived from the
 * route's `:id`, never trusted from the body (AC-6).
 */
const CreateEvalCaseBody = z.object({
  name: z.string().min(1),
  input_diff: z.string().nullish(),
  input_files: z.unknown().optional(),
  input_meta: z.unknown().optional(),
  expected_output: z.unknown().optional(),
  notes: z.string().nullish(),
});

/** `PUT /agents/:id/eval-cases/:caseId` — every field optional (partial update). */
const UpdateEvalCaseBody = CreateEvalCaseBody.partial();

/**
 * A4 — evals module (`specs/cross-cutting/eval-pipeline/plan.md` Work Item 8,
 * spec §10).
 *   POST   /findings/:id/eval-case            → turn an accepted/dismissed
 *                                                finding into a frozen case
 *   GET    /agents/:id/eval-cases              → list (workspace + agent scoped)
 *   POST   /agents/:id/eval-cases              → manual create
 *   PUT    /agents/:id/eval-cases/:caseId      → manual update
 *   DELETE /agents/:id/eval-cases/:caseId      → delete (cascades run history)
 *   POST   /agents/:id/eval-cases/:caseId/run  → run one case (N=1)
 *   POST   /agents/:id/eval-runs               → run the whole case set (N=all)
 *   GET    /agents/:id/eval-dashboard          → aggregate + trend + alert
 *
 * `EvalsService` is constructed directly here (constructor takes `Container`),
 * exactly like `RiskBriefService`/`BlastService` (`risk-brief/routes.ts:33`,
 * `blast/routes.ts:19`) — never registered as a new `Container` getter.
 * Handlers stay thin: parse `params`/`body` via zod, call the service, throw
 * `NotFoundError` on an `undefined` result, otherwise return the result with
 * the right status code (`agents/routes.ts`'s established shape).
 */
export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalsService(container);

  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      // `createFromFinding` throws `NotFoundError`/`ValidationError` itself
      // on every failure path (AC-3/AC-4) — no `undefined` result to check.
      const evalCase = await service.createFromFinding(workspaceId, req.params.id);
      reply.status(201);
      return evalCase;
    },
  );

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const cases = await service.listCases(workspaceId, req.params.id);
    if (!cases) throw new NotFoundError('Agent not found');
    return cases;
  });

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: CreateEvalCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const created = await service.createCase(workspaceId, req.params.id, req.body);
      if (!created) throw new NotFoundError('Agent not found');
      reply.status(201);
      return created;
    },
  );

  app.put(
    '/agents/:id/eval-cases/:caseId',
    { schema: { params: EvalCaseParams, body: UpdateEvalCaseBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const updated = await service.updateCase(
        workspaceId,
        req.params.id,
        req.params.caseId,
        req.body,
      );
      if (!updated) throw new NotFoundError('Eval case not found');
      return updated;
    },
  );

  app.delete(
    '/agents/:id/eval-cases/:caseId',
    { schema: { params: EvalCaseParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const ok = await service.deleteCase(workspaceId, req.params.id, req.params.caseId);
      if (!ok) throw new NotFoundError('Eval case not found');
      return { ok: true };
    },
  );

  app.post(
    '/agents/:id/eval-cases/:caseId/run',
    { schema: { params: EvalCaseParams, response: { 200: EvalRunResult } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.runOne(workspaceId, req.params.id, req.params.caseId);
      if (!result) throw new NotFoundError('Agent or eval case not found');
      return result;
    },
  );

  app.post('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const result = await service.runAll(workspaceId, req.params.id);
    if (!result) throw new NotFoundError('Agent not found');
    return result;
  });

  app.get('/agents/:id/eval-dashboard', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const dashboard = await service.getDashboard(workspaceId, req.params.id);
    if (!dashboard) throw new NotFoundError('Agent not found');
    return dashboard;
  });
}
