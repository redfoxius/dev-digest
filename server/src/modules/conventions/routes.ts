import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConventionCategory,
  ConventionStatus,
  CreateSkillFromConventionsBody,
  UpdateConventionBody,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConventionsService } from './service.js';

/**
 * Conventions module — Conventions Extractor (see docs/conventions-extractor-plan.md).
 *   POST   /repos/:id/conventions/extract        → run extraction (sync — one LLM call over ≤15 files)
 *   GET    /repos/:id/conventions                 → list (filterable by status/category)
 *   PATCH  /conventions/:id                       → edit rule/category or accept/reject
 *   POST   /repos/:id/conventions/skill-draft     → prefilled, editable skill draft from accepted candidates
 *   POST   /repos/:id/conventions/skill           → persist the skill (source: 'extracted')
 */

const RepoIdParams = z.object({ id: z.string().uuid() });

const ListConventionsQuery = z.object({
  status: ConventionStatus.optional(),
  category: ConventionCategory.optional(),
});

const SkillDraftBody = z.object({ candidate_ids: z.array(z.string()).min(1) });

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: RepoIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/conventions',
    { schema: { params: RepoIdParams, querystring: ListConventionsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, req.params.id, req.query);
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.updateCandidate(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: RepoIdParams, body: SkillDraftBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.buildSkillDraft(workspaceId, req.params.id, req.body.candidate_ids);
    },
  );

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: RepoIdParams, body: CreateSkillFromConventionsBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.createSkillFromCandidates(workspaceId, req.body);
      reply.status(201);
      return skill;
    },
  );
}
