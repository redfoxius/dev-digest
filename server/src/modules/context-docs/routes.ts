import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { ContextDocsService } from './service.js';

const RepoIdParams = z.object({ repoId: z.string().uuid() });

const PreviewQuery = z.object({ path: z.string().min(1) });

/** AC-7 — a configured exclude pattern can only narrow the already-
 *  `clonePath`-scoped walk result (`reader.ts`'s discovery still visits
 *  every `.md` file in the clone; excludes only remove candidates from that
 *  result), never widen it — unlike v0.1's include-glob allow-list, a
 *  pattern here (even one containing `..` segments or an absolute path)
 *  cannot cause a read outside `clonePath`, so the old `isGlobEscaping`
 *  escape-check is retired for this body. The one remaining validation is
 *  rejecting a pattern that is empty or whitespace-only after trimming —
 *  such a pattern is meaningless as an exclude and almost certainly a
 *  client-side mistake. */
const ContextConfigBody = z.object({
  excludes: z.array(z.string().min(1)),
}).superRefine((val, ctx) => {
  val.excludes.forEach((pattern, i) => {
    if (pattern.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Exclude pattern must not be empty or whitespace-only: ${JSON.stringify(pattern)}`,
        path: ['excludes', i],
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
 *   GET  /repos/:repoId/context-config         → { excludes } (`null` in the DB falls back to the default exclude set)
 *   PUT  /repos/:repoId/context-config         → persist a new exclude-pattern list verbatim, incl. `[]` (422 on an empty/whitespace-only pattern)
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
      return service.setConfig(workspaceId, req.params.repoId, req.body.excludes);
    },
  );
}
