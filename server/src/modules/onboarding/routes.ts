import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { OnboardingTourResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { OnboardingService } from './service.js';

const RepoIdParams = z.object({ repoId: z.string().uuid() });

/**
 * Onboarding Generator (docs/onboarding-generator-plan.md Work Item 8):
 *   GET  /repos/:repoId/onboarding             → persisted tour (or null),
 *                                                 zero LLM calls, default
 *                                                 (unrestricted) rate limit
 *                                                 (AC-32).
 *   POST /repos/:repoId/onboarding/regenerate  → exactly one fresh LLM call,
 *                                                 rate-limited to 10/min per
 *                                                 workspace (AC-31), exact
 *                                                 copy of `reviews/routes.ts`'s
 *                                                 `/pulls/:id/intent/derive`
 *                                                 config.
 * `RepoIdParams` mirrors `context-docs/routes.ts:8`'s `/repos/:repoId/...`
 * shape, not the generic `IdParams` most older modules use.
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new OnboardingService(container);

  app.get(
    '/repos/:repoId/onboarding',
    { schema: { params: RepoIdParams, response: { 200: OnboardingTourResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.get(workspaceId, req.params.repoId);
    },
  );

  app.post(
    '/repos/:repoId/onboarding/regenerate',
    {
      schema: { params: RepoIdParams, response: { 200: OnboardingTourResponse } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.regenerate(workspaceId, req.params.repoId, req.log);
    },
  );
}
