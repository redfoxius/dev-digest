import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { isGlobEscaping } from './glob-safety.js';
import { ContextDocsService } from './service.js';

const RepoIdParams = z.object({ repoId: z.string().uuid() });

const PreviewQuery = z.object({ path: z.string().min(1) });

/** AC-7 — a glob that would resolve outside the repo's own `clonePath`
 *  (`..` segments, an absolute path, a drive letter) is rejected with a 422
 *  right here at the route boundary, before the service ever runs — reusing
 *  `glob-safety.ts`'s `isGlobEscaping` (the same write-time check Work Item 1
 *  built, backstopped at read time by `repository.ts`'s `resolveWithinClone`
 *  use, AC-41). */
const ContextConfigBody = z.object({
  globs: z.array(z.string().min(1)).min(1),
}).superRefine((val, ctx) => {
  val.globs.forEach((glob, i) => {
    if (isGlobEscaping(glob)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Glob resolves outside the repo's clone path: ${glob}`,
        path: ['globs', i],
      });
    }
  });
});

/**
 * Project Context Folder — reader/reindex, search-root config, and Project
 * Context browser endpoints (spec §6.1-6.4, §10;
 * `docs/project-context-folder-plan.md` Work Items 3, 4, 5, 6). Transport
 * layer only — params/body/query validated via zod (422 before the handler
 * runs), everything else delegates to `ContextDocsService`.
 *
 *   GET  /repos/:repoId/context-docs           → discovered documents + index status
 *   POST /repos/:repoId/context-docs/reindex   → rescan + (gated) chunk/embed
 *   GET  /repos/:repoId/context-docs/preview   → raw file content, read-only (404 if undiscovered)
 *   GET  /repos/:repoId/context-config         → { globs } (falls back to the default glob)
 *   PUT  /repos/:repoId/context-config         → persist a new glob list (422 on an escaping glob)
 *
 * Every route is workspace-scoped via `getContext` + `ContextDocsService`'s
 * own ownership check — a `repoId` from another workspace resolves to a 404
 * (AC-40), mirroring the existing `GET /pulls/:id/blast` pattern.
 */
export default async function contextDocsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ContextDocsService(app.container);

  app.get('/repos/:repoId/context-docs', { schema: { params: RepoIdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.repoId);
  });

  app.post(
    '/repos/:repoId/context-docs/reindex',
    { schema: { params: RepoIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.reindex(workspaceId, req.params.repoId);
    },
  );

  app.get(
    '/repos/:repoId/context-docs/preview',
    { schema: { params: RepoIdParams, querystring: PreviewQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.preview(workspaceId, req.params.repoId, req.query.path);
    },
  );

  app.get('/repos/:repoId/context-config', { schema: { params: RepoIdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getConfig(workspaceId, req.params.repoId);
  });

  app.put(
    '/repos/:repoId/context-config',
    { schema: { params: RepoIdParams, body: ContextConfigBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setConfig(workspaceId, req.params.repoId, req.body.globs);
    },
  );
}
