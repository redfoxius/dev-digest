import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import multipart from '@fastify/multipart';
import { CreateSkillBody, ImportCandidate, SkillSource, SkillType, UpdateSkillBody } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { MAX_ARCHIVE_BYTES } from './constants.js';
import { SkillsService } from './service.js';

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/** `/skills/community/:name/import` — name addresses the static seed by slug. */
const CommunityNameParams = z.object({ name: z.string().min(1) });

/** `/skills/:id/context-docs/:path` — id a uuid, path a percent-encoded
 *  repo-relative document path (a raw `/` inside it arrives percent-encoded
 *  as `%2F`; Fastify's router already decodes it once before the handler
 *  sees `req.params.path` — never re-decode it). */
const SkillContextDocParams = z.object({ id: z.string().uuid(), path: z.string().min(1) });

/** Every context-docs route is scoped to the client's single active repo —
 *  agents/skills are workspace-scoped while discovered documents are
 *  repo-scoped (spec §4), and there's no `:repoId` segment on these routes
 *  (spec §10), so the active repo travels as a query param instead. */
const ContextDocsQuery = z.object({ repo_id: z.string().uuid() });

/** Bulk set/reorder — mirrors `SetSkillsBody.skill_ids`'s full-ordered-list contract. */
const SetContextDocsBody = z.object({ paths: z.array(z.string().min(1)) });

const SetContextDocEnabledBody = z.object({ enabled: z.boolean() });

/**
 * A1 — skills module (owner A1).
 *   GET    /skills                          → list (workspace-scoped, filterable)
 *   GET    /skills/:id                      → one skill
 *   POST   /skills                          → direct create (source: manual, enabled: true)
 *   PUT    /skills/:id                      → update — versions on real change
 *   DELETE /skills/:id                      → delete
 *   GET    /skills/:id/versions             → version history (newest first)
 *   GET    /skills/:id/versions/:version    → one version snapshot
 *   POST   /skills/:id/versions/:version/restore → restore (creates a NEW version)
 *   GET    /skills/:id/stats                → Stats tab (used_by, pull frequency, accept rate, findings)
 *   GET    /skills/:id/context-docs         → attached context docs for ?repo_id=... (ordered)
 *   POST   /skills/:id/context-docs         → set/reorder attached context docs (full ordered path list)
 *   PATCH  /skills/:id/context-docs/:path   → attach+enable (if unattached) or toggle
 *                                              enabled (if attached) — the Context-tab checkbox action
 *   POST   /skills/import/file/preview      → multipart upload → ImportCandidate preview
 *   POST   /skills/import/file/confirm      → persists (source: manual, enabled: true)
 *   POST   /skills/import/url/preview       → fetch URL server-side → ImportCandidate preview
 *   POST   /skills/import/url/confirm       → persists (source: imported_url, enabled: false)
 *   GET    /skills/community                → static curated CommunitySkill[] seed
 *   POST   /skills/community/:name/import   → persists (source: community, enabled: false)
 */

const ListSkillsQuery = z.object({
  type: SkillType.optional(),
  source: SkillSource.optional(),
  // NOT z.coerce.boolean() — that treats any non-empty string (including
  // "false") as truthy, silently inverting `?enabled=false`.
  enabled: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// `.nullish()` + transform (rather than `.default({})`) because an empty
// fastify request body arrives as `null`, not `undefined` — `.default()`
// only substitutes for `undefined`, so a bodyless restore call would
// otherwise 422 on "expected object, received null".
const RestoreVersionBody = z
  .object({ summary: z.string().optional() })
  .nullish()
  .transform((v) => v ?? {});

const UrlImportBody = z.object({ url: z.string().url() });

const StatsQuery = z.object({ days: z.coerce.number().int().positive().max(365).default(30) });

/** The candidate an import-confirm endpoint accepts back — the (possibly
 *  user-edited) `ImportCandidate` preview, plus the extraction-only
 *  `evidence_files` list (not part of the shared `ImportCandidate` contract,
 *  but round-tripped from the preview response so it can be persisted). */
const ImportConfirmBody = ImportCandidate.extend({
  evidence_files: z.array(z.string()).optional(),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  // Scoped to THIS module's encapsulation context — other modules never see
  // `request.file()`/`isMultipart()` (Fastify plugin encapsulation).
  // Every limit set explicitly, not just `fileSize`/`files` — the only
  // route on this plugin (`/skills/import/file/preview`) reads exactly one
  // file part via `req.file()` and never any non-file field, so `fields`/
  // `parts` are capped tight rather than left at @fastify/multipart's
  // effectively-unbounded defaults, which would otherwise let a client
  // flood the request with junk form parts before `req.file()` gets a
  // chance to reject anything.
  await app.register(multipart, {
    limits: {
      fieldNameSize: 100,
      fieldSize: 1024,
      fields: 0,
      fileSize: MAX_ARCHIVE_BYTES,
      files: 1,
      headerPairs: 100,
      parts: 4,
    },
    throwFileSizeLimit: true,
  });

  app.get('/skills', { schema: { querystring: ListSkillsQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.query);
  });

  // Community routes are registered before `/skills/:id` so the literal
  // `/skills/community` segment never gets swallowed by the `:id` param.
  app.get('/skills/community', async () => {
    return service.listCommunitySkills();
  });

  app.post(
    '/skills/community/:name/import',
    { schema: { params: CommunityNameParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.importCommunitySkill(workspaceId, req.params.name);
      reply.status(201);
      return skill;
    },
  );

  app.post(
    '/skills/import/file/preview',
    async (req) => {
      await getContext(app.container, req);
      const data = await req.file();
      if (!data) throw new ValidationError('Expected a multipart file field');
      const buffer = await data.toBuffer();
      return service.previewFileUpload(buffer, data.filename);
    },
  );

  app.post(
    '/skills/import/file/confirm',
    { schema: { body: ImportConfirmBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.confirmFileImport(workspaceId, req.body);
      reply.status(201);
      return skill;
    },
  );

  app.post(
    '/skills/import/url/preview',
    { schema: { body: UrlImportBody } },
    async (req) => {
      await getContext(app.container, req);
      return service.previewUrlImport(req.body.url);
    },
  );

  app.post(
    '/skills/import/url/confirm',
    { schema: { body: ImportConfirmBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.confirmUrlImport(workspaceId, req.body);
      reply.status(201);
      return skill;
    },
  );

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, req.body);
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get(
    '/skills/:id/versions/:version',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Skill version not found');
      return version;
    },
  );

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams, body: RestoreVersionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restoreVersion(
        workspaceId,
        req.params.id,
        req.params.version,
        req.body.summary,
      );
      if (!skill) throw new NotFoundError('Skill or version not found');
      return skill;
    },
  );

  app.get(
    '/skills/:id/stats',
    { schema: { params: IdParams, querystring: StatsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const stats = await service.getStats(workspaceId, req.params.id, req.query.days);
      if (!stats) throw new NotFoundError('Skill not found');
      return stats;
    },
  );

  app.get(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, querystring: ContextDocsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const links = await service.contextDocLinks(workspaceId, req.params.id, req.query.repo_id);
      if (!links) throw new NotFoundError('Skill or repo not found');
      return links;
    },
  );

  app.post(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, querystring: ContextDocsQuery, body: SetContextDocsBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const links = await service.setContextDocs(
        workspaceId,
        req.params.id,
        req.query.repo_id,
        req.body.paths,
      );
      if (!links) throw new NotFoundError('Skill or repo not found');
      return links;
    },
  );

  app.patch(
    '/skills/:id/context-docs/:path',
    {
      schema: {
        params: SkillContextDocParams,
        querystring: ContextDocsQuery,
        body: SetContextDocEnabledBody,
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      // Fastify's router (find-my-way) already decodes every route param
      // exactly once before it reaches `req.params` — re-decoding here
      // double-decodes it, throwing an uncaught `URIError` for any real
      // filename containing a literal `%` (e.g. "50%-notes.md").
      const path = req.params.path;
      const links = await service.setContextDocEnabled(
        workspaceId,
        req.params.id,
        req.query.repo_id,
        path,
        req.body.enabled,
      );
      if (!links) throw new NotFoundError('Skill or repo not found');
      return links;
    },
  );
}
