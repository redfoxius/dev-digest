import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import AdmZip from 'adm-zip';
import { list as tarList } from 'tar';
import type { ReadEntry } from 'tar';
import type { Container } from '../../platform/container.js';
import type {
  CommunitySkill,
  ImportCandidate,
  Skill,
  SkillContextDocLink,
  SkillSource,
  SkillStats,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { AppError, ExternalServiceError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { isGlobEscaping } from '../context-docs/glob-safety.js';
import { SkillsRepository } from './repository.js';
import {
  detectArchiveKind,
  deriveSkillNameFromBody,
  extractMarkdownFromEntries,
  fileStem,
  isMarkdownFilename,
  looksLikeHtmlDocument,
  restoreSummary,
  toSkillDto,
  toSkillVersionDto,
  type ArchiveFileEntry,
} from './helpers.js';
import {
  COMMUNITY_SKILLS_SEED,
  MAX_ARCHIVE_BYTES,
  MAX_DECOMPRESSED_BYTES,
  URL_IMPORT_BODY_TIMEOUT_MS,
} from './constants.js';

/**
 * A1 — skills service. Business logic for the standalone Skills page +
 * the import pipeline (paste / file+archive upload / URL / community).
 *
 * A Skill = name + description + type + body (pure text/config, never
 * executable) + enabled + source. Config changes (name/description/type/
 * body) are versioned via `skill_versions` (repository).
 *
 * Trust model (see docs/skills-feature-plan.md, Decision 3): a human
 * providing content directly to the app — typed, pasted, OR uploaded as a
 * file/archive — is `source: 'manual'`, created `enabled: true`. Content
 * fetched without a human in the loop (`imported_url`, `community`) is
 * created `enabled: false` ("needs vetting") until a human flips it on.
 * `assemblePrompt()` (reviewer-core) separately wraps EVERY skill body as
 * untrusted regardless of source — that gate is orthogonal to this one.
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  /** One-line note for the `skill_versions` snapshot this update creates. */
  summary?: string;
}

export interface ListSkillsFilters {
  type?: SkillType;
  source?: SkillSource;
  enabled?: boolean;
}

/** An `ImportCandidate` plus the extraction-only `evidence_files` list (other
 *  markdown files found alongside the main one). Not part of the shared
 *  `ImportCandidate` contract (no route validates a response schema against
 *  it), but threaded through so a confirm can persist them. */
export type ImportPreview = ImportCandidate & { evidence_files: string[] };

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  // ---- CRUD -----------------------------------------------------------

  async list(workspaceId: string, filters: ListSkillsFilters = {}): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId, filters);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Direct create (`source: 'manual'`, `enabled: true`) — the "+ New skill"
   *  blank-create button AND the paste sub-form in the "From file" tab both
   *  call this; the paste form's name+body IS the final content. */
  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      body: input.body,
      source: 'manual',
      enabled: true,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(
      workspaceId,
      id,
      {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      },
      patch.summary,
    );
    return row ? toSkillDto(row) : undefined;
  }

  // ---- versions ---------------------------------------------------------

  /** Version history for a skill, newest first. Workspace-scoped: undefined
   *  when the skill isn't in this workspace (route → 404). */
  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  async getVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(skillId, version);
    return row ? toSkillVersionDto(row) : undefined;
  }

  /**
   * Restore an old version: fetch its body, then call `update()` with it —
   * this creates a NEW version whose body matches the old one; history is
   * never rewritten in place. Summary defaults to `"Restored from v{n}"`.
   */
  async restoreVersion(
    workspaceId: string,
    skillId: string,
    version: number,
    summary?: string,
  ): Promise<Skill | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const versionRow = await this.repo.getVersion(skillId, version);
    if (!versionRow) return undefined;

    const row = await this.repo.update(
      workspaceId,
      skillId,
      { body: versionRow.body },
      summary ?? restoreSummary(version),
    );
    return row ? toSkillDto(row) : undefined;
  }

  // ---- stats (docs/skills-feature-plan.md#stats-tab--addendum) -----------

  /** Workspace-scoped: undefined when the skill isn't in this workspace
   *  (route → 404), same pattern as `listVersions`/`getVersion`. */
  async getStats(workspaceId: string, skillId: string, days: number): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    return this.repo.getStats(workspaceId, skillId, days);
  }

  // ---- skill_context_docs (Skill Editor's Context tab — Project Context
  // Folder, docs/project-context-folder-plan.md Work Item 9) ----------------

  /**
   * Context docs attached to a skill for `repoId`, ordered, each with its
   * `document` resolved against the latest `context_documents` scan (`null`
   * when the path no longer resolves — AC-22). Workspace-scoped: undefined
   * when either the skill or the repo isn't in this workspace (route → 404),
   * mirroring `listVersions`/`getStats`'s existing 404 pattern.
   */
  async contextDocLinks(
    workspaceId: string,
    skillId: string,
    repoId: string,
  ): Promise<SkillContextDocLink[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) return undefined;
    return this.buildContextDocLinks(skillId, repoId);
  }

  /**
   * Rejects an attach path that could resolve outside the repo's clone path
   * (a `..` segment, a leading `/`/`\`, a drive-letter) — the same write-time
   * check `context-docs/routes.ts`'s `ContextConfigBody` already applies to
   * search-root globs (AC-7), reused here for a single relative file path.
   * Deliberately does NOT require the path to already exist in
   * `context_documents` — AC-22 explicitly allows attaching a path before
   * it's ever been discovered (or after a later rescan removes it), resolving
   * `document: null` in the link response until a future scan finds it. The
   * actual symlink-escape defense lives at read time
   * (`resolveWithinClone` + `verifyRealpathWithinClone` in resolve.ts /
   * context-docs `repository.ts`) — this is only the cheap, obviously-
   * malformed-path reject. Mirrors `AgentsService.assertPathsAttachable`
   * exactly.
   */
  private assertPathsAttachable(paths: string[]): void {
    const escaping = paths.filter((p) => isGlobEscaping(p));
    if (escaping.length > 0) {
      throw new ValidationError("Path resolves outside the repo's clone path", { paths: escaping });
    }
  }

  /**
   * Set / reorder the skill's attached context docs (bulk, full ordered
   * list — mirrors `AgentsService.setSkills`). Each path's current `enabled`
   * state is preserved across the replace (see
   * `SkillsRepository.setSkillContextDocs`'s doc comment) — a pure reorder
   * never silently re-enables an unrelated, currently-unchecked path.
   */
  async setContextDocs(
    workspaceId: string,
    skillId: string,
    repoId: string,
    paths: string[],
  ): Promise<SkillContextDocLink[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) return undefined;
    this.assertPathsAttachable(paths);
    await this.repo.setSkillContextDocs(skillId, repoId, paths);
    return this.buildContextDocLinks(skillId, repoId);
  }

  /**
   * The Skill Editor's Context tab checkbox: checking a not-yet-attached
   * document both attaches it (appended at the end of the current order) AND
   * enables it in one call; unchecking an attached document flips `enabled`
   * off without detaching it (mirrors `AgentsService.setSkillEnabled`).
   */
  async setContextDocEnabled(
    workspaceId: string,
    skillId: string,
    repoId: string,
    path: string,
    enabled: boolean,
  ): Promise<SkillContextDocLink[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) return undefined;
    this.assertPathsAttachable([path]);
    await this.repo.setSkillContextDocEnabled(skillId, repoId, path, enabled);
    return this.buildContextDocLinks(skillId, repoId);
  }

  /** Shared assembly: link rows + their resolved `document` (joined against
   *  `context_documents` + used-by counts), in `order` ascending. */
  private async buildContextDocLinks(skillId: string, repoId: string): Promise<SkillContextDocLink[]> {
    const links = await this.repo.skillContextDocs(skillId, repoId);
    if (links.length === 0) return [];
    const paths = new Set(links.map((l) => l.path));
    // Cross-module read of the `context_documents` catalog via
    // `container.contextDocsRepo` (not this module's own repository.ts —
    // onion-architecture: repositories stay drizzle-only, cross-module
    // orchestration lives here in the service). No batch-by-paths method
    // exists on `ContextDocsRepository`, so `listByRepo` is filtered
    // client-side to the paths this skill has attached.
    const [allDocs, usedByPath] = await Promise.all([
      this.container.contextDocsRepo.listByRepo(repoId),
      this.container.contextDocsRepo.usedByCounts(repoId),
    ]);
    const docsByPath = new Map(allDocs.filter((d) => paths.has(d.path)).map((d) => [d.path, d]));
    return links.map((l) => {
      const doc = docsByPath.get(l.path);
      const usedBy = usedByPath.get(l.path) ?? { agents: 0, skills: 0 };
      return {
        path: l.path,
        order: l.order,
        enabled: l.enabled,
        document: doc
          ? {
              id: doc.id,
              path: doc.path,
              root: doc.root,
              size_bytes: doc.sizeBytes,
              chunk_count: doc.chunkCount,
              index_status: doc.indexStatus,
              used_by_agents: usedBy.agents,
              used_by_skills: usedBy.skills,
              last_indexed_at: doc.lastIndexedAt.toISOString(),
            }
          : null,
      };
    });
  }

  // ---- import: file upload / archive (in-memory only) --------------------

  /**
   * Extract an uploaded file into an `ImportCandidate` preview. `.md`/
   * `.markdown` → the whole buffer is the body. `.zip`/`.tar`/`.tar.gz`/
   * `.tgz` → extracted IN MEMORY (adm-zip / tar, never written to disk):
   * the main markdown file becomes the body, other `.md` files become
   * `evidence_files`, every non-markdown entry's name goes into
   * `ignored_files`. Nothing in an archive is ever executed, required, or
   * eval'd — only markdown entries' text content is read.
   */
  async previewFileUpload(buffer: Buffer, filename: string): Promise<ImportPreview> {
    if (buffer.length > MAX_ARCHIVE_BYTES) {
      throw new ValidationError(`File exceeds the ${MAX_ARCHIVE_BYTES}-byte limit`);
    }

    if (isMarkdownFilename(filename)) {
      const body = buffer.toString('utf8');
      if (looksLikeHtmlDocument(body)) {
        throw new ValidationError(`${filename} looks like an HTML document, not markdown`);
      }
      const name = deriveSkillNameFromBody(body) ?? fileStem(filename);
      return { name, description: '', type: 'custom', body, ignored_files: [], evidence_files: [] };
    }

    const kind = detectArchiveKind(filename);
    if (!kind) {
      throw new ValidationError(
        `Unsupported file type: ${filename} (expected .md, .markdown, .zip, .tar, or .tar.gz)`,
      );
    }

    const entries = kind === 'zip' ? readZipEntries(buffer) : await readTarEntries(maybeGunzip(buffer));
    const extracted = extractMarkdownFromEntries(entries, fileStem(filename));
    if (!extracted.mainFile) {
      throw new ValidationError('Archive has no markdown file to use as the skill body');
    }

    const name = deriveSkillNameFromBody(extracted.body) ?? fileStem(filename);
    return {
      name,
      description: '',
      type: 'custom',
      body: extracted.body,
      ignored_files: extracted.ignored_files,
      evidence_files: extracted.evidence_files,
    };
  }

  /** Persist a file/archive-upload candidate — `source: 'manual'` (a human
   *  provided it to the app directly), `enabled: true`. */
  async confirmFileImport(
    workspaceId: string,
    candidate: ImportCandidate & { evidence_files?: string[] },
  ): Promise<Skill> {
    return this.persist(workspaceId, candidate, 'manual', true);
  }

  // ---- import: URL --------------------------------------------------------

  /** Fetch a URL server-side (via the `urlFetcher` port — SSRF guard lives
   *  there, not here) and extract it the same way as a file upload (by its
   *  path's extension), returning an `ImportCandidate` preview. */
  async previewUrlImport(url: string): Promise<ImportPreview> {
    let res: Response;
    try {
      res = await this.container.urlFetcher.fetch(url);
    } catch (err) {
      // The urlFetcher port already throws a correctly-typed AppError (422)
      // for a disallowed scheme/SSRF target/unresolvable host — pass those
      // through as-is; only a genuine network-level failure (timeout,
      // connection refused, ...) becomes a 502 "external service" error.
      if (err instanceof AppError) throw err;
      throw new ExternalServiceError(`Failed to fetch ${url}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new ExternalServiceError(`Failed to fetch ${url}: HTTP ${res.status}`);
    }
    // A rendered webpage (someone linking the article instead of the raw
    // file) declares this honestly almost always — reject before spending
    // the read/decompress budget on it. Content sniffing below is the
    // backstop for a server that mislabels it.
    const contentType = res.headers.get('content-type') ?? '';
    if (/\btext\/html\b|\bapplication\/xhtml\+xml\b/i.test(contentType)) {
      throw new ValidationError(
        `${url} returned HTML (content-type: ${contentType}), not a markdown/plain-text skill — link the raw file, not a rendered page`,
      );
    }

    const buffer = await readBodyWithLimit(res, url);

    const pathname = safeUrlPathname(url);
    const filename = pathname.split('/').filter(Boolean).pop() || 'skill.md';

    const kind = detectArchiveKind(filename);
    if (!kind) {
      // No recognized archive extension → treat the whole response as markdown
      // text (covers `.md` URLs and plain-text pages alike).
      const body = buffer.toString('utf8');
      if (looksLikeHtmlDocument(body)) {
        throw new ValidationError(`${url} looks like an HTML document, not markdown`);
      }
      const name = deriveSkillNameFromBody(body) ?? (fileStem(filename) || 'Imported skill');
      return { name, description: '', type: 'custom', body, ignored_files: [], evidence_files: [] };
    }

    const entries = kind === 'zip' ? readZipEntries(buffer) : await readTarEntries(maybeGunzip(buffer));
    const extracted = extractMarkdownFromEntries(entries, fileStem(filename));
    if (!extracted.mainFile) {
      throw new ValidationError('Archive has no markdown file to use as the skill body');
    }
    const name = deriveSkillNameFromBody(extracted.body) ?? fileStem(filename);
    return {
      name,
      description: '',
      type: 'custom',
      body: extracted.body,
      ignored_files: extracted.ignored_files,
      evidence_files: extracted.evidence_files,
    };
  }

  /** Persist a URL-import candidate — `source: 'imported_url'`, `enabled:
   *  false` (fetched without a human in the loop; needs vetting). */
  async confirmUrlImport(
    workspaceId: string,
    candidate: ImportCandidate & { evidence_files?: string[] },
  ): Promise<Skill> {
    return this.persist(workspaceId, candidate, 'imported_url', false);
  }

  // ---- import: community ---------------------------------------------------

  /** Static curated seed — course-scope demo, not a live registry fetch. */
  listCommunitySkills(): CommunitySkill[] {
    return COMMUNITY_SKILLS_SEED;
  }

  /** Persist a community-catalog entry — `source: 'community'`, `enabled:
   *  false` (fetched without a human in the loop; needs vetting). Body is a
   *  short synthesized markdown doc from the seed's own description (this is
   *  a course-scope demo seed, not a real fetch from `repo`). */
  async importCommunitySkill(workspaceId: string, name: string): Promise<Skill> {
    const entry = COMMUNITY_SKILLS_SEED.find((s) => s.name === name);
    if (!entry) throw new NotFoundError(`Unknown community skill: ${name}`);

    const body = [
      `# ${entry.name}`,
      '',
      entry.desc,
      '',
      `Source: [${entry.repo}](https://github.com/${entry.repo}) — ★${entry.stars}, ${entry.lang}.`,
      '',
      '_Community-imported skill — review before enabling._',
    ].join('\n');

    return this.persist(
      workspaceId,
      { name: entry.name, description: entry.desc, type: 'custom', body },
      'community',
      false,
    );
  }

  // ---- shared persist helper -----------------------------------------------

  private async persist(
    workspaceId: string,
    candidate: { name: string; description?: string; type: SkillType; body: string; evidence_files?: string[] },
    source: SkillSource,
    enabled: boolean,
  ): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: candidate.name,
      description: candidate.description,
      type: candidate.type,
      body: candidate.body,
      source,
      enabled,
      ...(candidate.evidence_files?.length ? { evidenceFiles: candidate.evidence_files } : {}),
    });
    return toSkillDto(row);
  }
}

// ---- archive reading (in-memory only; no disk writes, no exec) -------------
//
// `MAX_ARCHIVE_BYTES` only bounds the COMPRESSED input; both readers below
// separately cap the DECOMPRESSED output at `MAX_DECOMPRESSED_BYTES` — a
// small crafted archive can otherwise expand to gigabytes in memory (a
// decompression bomb) before any markdown-extraction logic ever runs.

/** ZIP local/central-directory compression-method codes (APPNOTE.TXT §4.4.5) —
 *  the only two `adm-zip` itself decompresses; any other method already
 *  fails at `new AdmZip(buffer)`/`zip.getEntries()`. */
const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATED = 8;

function readZipEntries(buffer: Buffer): ArchiveFileEntry[] {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch (err) {
    throw new ValidationError(`Could not read zip archive: ${(err as Error).message}`);
  }
  const fileEntries = zip.getEntries().filter((e) => !e.isDirectory);

  // Check declared uncompressed sizes BEFORE decompressing anything, so an
  // obviously-oversized archive is rejected up front.
  const declaredTotal = fileEntries.reduce((sum, e) => sum + e.header.size, 0);
  if (declaredTotal > MAX_DECOMPRESSED_BYTES) {
    throw new ValidationError(
      `Archive's uncompressed size (${declaredTotal} bytes) exceeds the ${MAX_DECOMPRESSED_BYTES}-byte limit`,
    );
  }

  // Zip entry headers are attacker-controlled and can lie about the declared
  // size — decompress each entry OURSELVES against the REMAINING global
  // budget, via `zlib.inflateRawSync`'s own `maxOutputLength` (which makes
  // zlib itself abort mid-inflation once output would exceed the cap,
  // instead of fully materializing an oversized buffer first). Deliberately
  // NOT using `entry.getData()` — that trusts the entry's own (attacker-
  // controlled) declared size for its internal cap rather than our shared
  // remaining budget, so a small declared-size lie on one entry couldn't be
  // caught against how much budget every EARLIER entry in the same archive
  // already spent.
  let remaining = MAX_DECOMPRESSED_BYTES;
  return fileEntries.map((e) => {
    const compressed = e.getCompressedData();
    let content: Buffer;
    if (e.header.method === ZIP_METHOD_STORED) {
      content = compressed;
    } else if (e.header.method === ZIP_METHOD_DEFLATED) {
      try {
        content = zlib.inflateRawSync(compressed, { maxOutputLength: remaining });
      } catch (err) {
        throw new ValidationError(
          `Archive's actual uncompressed size exceeds the ${MAX_DECOMPRESSED_BYTES}-byte limit: ${(err as Error).message}`,
        );
      }
    } else {
      throw new ValidationError(`Unsupported zip compression method for "${e.entryName}"`);
    }
    if (zlib.crc32(content) !== e.header.crc) {
      throw new ValidationError(`Zip entry "${e.entryName}" failed CRC-32 validation (corrupt archive)`);
    }
    if (content.length > remaining) {
      throw new ValidationError(
        `Archive's actual uncompressed size exceeds the ${MAX_DECOMPRESSED_BYTES}-byte limit`,
      );
    }
    remaining -= content.length;
    return { name: e.entryName, content };
  });
}

/**
 * gzip-decompress a buffer if it starts with the gzip magic bytes (0x1f 0x8b);
 * otherwise return it unchanged (a plain, non-gzipped `.tar`). `maxOutputLength`
 * makes `gunzipSync` itself throw (`ERR_BUFFER_TOO_LARGE`) once decompressed
 * output would exceed the cap, instead of fully materializing a bomb first.
 */
function maybeGunzip(buffer: Buffer): Buffer {
  if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      return zlib.gunzipSync(buffer, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
    } catch (err) {
      throw new ValidationError(
        `Archive's uncompressed size exceeds the ${MAX_DECOMPRESSED_BYTES}-byte limit: ${(err as Error).message}`,
      );
    }
  }
  return buffer;
}

/**
 * Read a (non-gzipped) tar buffer's file entries into memory via `tar.list`'s
 * streaming parser — no `cwd`/`file` option is ever passed, so nothing is
 * written to disk. Each entry's bytes are collected from its own readable
 * stream; nothing is executed or required.
 */
async function readTarEntries(buffer: Buffer): Promise<ArchiveFileEntry[]> {
  const entries: ArchiveFileEntry[] = [];
  const collectors: Promise<void>[] = [];
  // Defense in depth alongside `maybeGunzip`'s `maxOutputLength` (which
  // already bounds a gzipped tar's decompressed size before it ever reaches
  // here) — also caps a plain, non-gzipped `.tar`'s total entry bytes.
  let total = 0;

  await new Promise<void>((resolve, reject) => {
    const parser = tarList({
      noResume: true,
      onentry: (entry: ReadEntry) => {
        if (entry.type !== 'File') {
          entry.resume();
          return;
        }
        const chunks: Buffer[] = [];
        collectors.push(
          new Promise<void>((res, rej) => {
            entry.on('data', (chunk: Buffer) => {
              total += chunk.length;
              if (total > MAX_DECOMPRESSED_BYTES) {
                rej(new Error(`tar entries exceed the ${MAX_DECOMPRESSED_BYTES}-byte limit`));
                return;
              }
              chunks.push(chunk);
            });
            entry.on('end', () => {
              entries.push({ name: entry.path, content: Buffer.concat(chunks) });
              res();
            });
          }),
        );
      },
    }) as unknown as NodeJS.WritableStream & { on: (event: string, cb: (arg?: unknown) => void) => void };

    parser.on('error', (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
    parser.on('end', () => resolve());
    Readable.from(buffer).pipe(parser as unknown as NodeJS.WritableStream);
  }).catch((err) => {
    throw new ValidationError(`Could not read tar archive: ${(err as Error).message}`);
  });

  await Promise.all(collectors).catch((err) => {
    throw new ValidationError(`Could not read tar archive: ${(err as Error).message}`);
  });
  return entries;
}

/**
 * Reads a fetch `Response` body as a `Buffer`, enforcing BOTH a size cap and
 * a read-duration timeout DURING the read — not after the fact. Streams
 * chunk-by-chunk via the body's own reader and aborts (cancels the
 * underlying stream) the moment either limit is crossed, so an
 * attacker-controlled URL can't force this process to buffer an unbounded
 * or slow-drip response in memory (`HttpUrlFetcher`'s own timeout only
 * covers the connect/headers phase, not this one).
 */
async function readBodyWithLimit(res: Response, url: string): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) throw new ExternalServiceError(`Failed to fetch ${url}: empty response body`);

  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel('body read timed out').catch(() => {});
  }, URL_IMPORT_BODY_TIMEOUT_MS);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ARCHIVE_BYTES) {
        await reader.cancel('exceeds max size').catch(() => {});
        throw new ValidationError(`Fetched content exceeds the ${MAX_ARCHIVE_BYTES}-byte limit`);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (timedOut) {
      throw new ExternalServiceError(`Failed to fetch ${url}: response body took too long to arrive`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

function safeUrlPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}
