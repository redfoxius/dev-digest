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
}
