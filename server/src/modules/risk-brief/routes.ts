import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { RiskBrief, RiskBriefGenerateResult } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { RiskBriefService } from './service.js';

/**
 * `RiskBriefGenerateBody` — the POST body's own tolerant-manual-parse
 * schema, mirroring `/pulls/:id/review`'s established precedent
 * (`reviews/routes.ts:30-47`): deliberately NOT a route-level `body:` schema
 * entry, since an empty/absent body must be valid (`{}` defaults `force` to
 * `false`).
 */
const RiskBriefGenerateBody = z.object({ force: z.boolean().optional() });

/**
 * risk-brief module (`specs/cross-cutting/pr-why-risk-brief/plan.md` Work
 * Item 8, spec §10).
 *   GET  /pulls/:id/brief  → persisted RiskBrief | null — never calls the
 *                            LLM (AC-1/AC-2), default (unrestricted) rate
 *                            limit since it only reads already-persisted
 *                            data (AC-16).
 *   POST /pulls/:id/brief  → RiskBriefGenerateResult — generates (or
 *                            returns a cache hit for) a Risk Brief;
 *                            rate-limited to 10/min, identical shape to
 *                            `/pulls/:id/intent/derive`'s config
 *                            (`reviews/routes.ts:161-166`) (AC-15).
 * `RiskBriefService` is constructed directly here (constructor takes
 * `Container`), exactly like `BlastService`/`ReviewService` — never
 * registered as a new `Container` getter.
 */
export default async function riskBriefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new RiskBriefService(container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: RiskBrief.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.get(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, response: { 200: RiskBriefGenerateResult } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const body = RiskBriefGenerateBody.parse(req.body ?? {});
      return service.generate(workspaceId, req.params.id, body.force ?? false, req.log);
    },
  );
}
