import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastRadiusResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * blast module (docs/blast-radius-plan.md).
 *   GET /pulls/:id/blast → BlastRadiusResponse — which symbols the PR's
 *                           diff changed, who calls them, and which HTTP
 *                           endpoints/cron jobs are reachable from those
 *                           callers. Read-only over the already-persisted
 *                           repo-intel index (`container.repoIntel.getBlastRadius`)
 *                           — no AST/import-graph rebuild on this path, no
 *                           LLM call.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastRadiusResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getBlastRadius(workspaceId, req.params.id);
    },
  );
}
