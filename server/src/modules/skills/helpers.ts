import { extname, basename } from 'node:path';
import type { Skill, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from './repository.js';
import { ALLOWED_MARKDOWN_EXTENSIONS, ARCHIVE_EXTENSIONS } from './constants.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping, the
 * config-version-bump rule, and archive/markdown extraction. No I/O (the
 * extraction helpers take already-read bytes/entries; service.ts owns the
 * adm-zip/tar/fetch calls) — kept here so they're unit-testable without a DB.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/** Map a persisted `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    summary: row.summary ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/** Fields whose change bumps the skill's version (name/description/type/body — NOT `enabled`). */
export interface SkillConfigChangePatch {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
}

/**
 * True when a patch changes config (name/description/type/body) relative to
 * the existing row — a config change bumps the version and snapshots
 * `skill_versions`. Mirrors `agents/helpers.ts`'s `isConfigChange`, except
 * `enabled` is never a config field here either way.
 */
export function isSkillConfigChange(
  existing: Pick<SkillRow, 'name' | 'description' | 'type' | 'body'>,
  patch: SkillConfigChangePatch,
): boolean {
  return (
    (patch.name !== undefined && patch.name !== existing.name) ||
    (patch.description !== undefined && patch.description !== existing.description) ||
    (patch.type !== undefined && patch.type !== existing.type) ||
    (patch.body !== undefined && patch.body !== existing.body)
  );
}

/** Human-readable field names changed by `patch` relative to `existing`. */
export function describeChangedSkillFields(
  existing: Pick<SkillRow, 'name' | 'description' | 'type' | 'body'>,
  patch: SkillConfigChangePatch,
): string[] {
  const fields: string[] = [];
  if (patch.name !== undefined && patch.name !== existing.name) fields.push('name');
  if (patch.description !== undefined && patch.description !== existing.description) {
    fields.push('description');
  }
  if (patch.type !== undefined && patch.type !== existing.type) fields.push('type');
  if (patch.body !== undefined && patch.body !== existing.body) fields.push('body');
  return fields;
}

/**
 * Default one-line `skill_versions.summary` when the caller omits one on
 * update — `"Updated {field(s)}"`, e.g. `"Updated body"` or
 * `"Updated name, description"`.
 */
export function defaultUpdateSummary(
  existing: Pick<SkillRow, 'name' | 'description' | 'type' | 'body'>,
  patch: SkillConfigChangePatch,
): string {
  const fields = describeChangedSkillFields(existing, patch);
  return fields.length ? `Updated ${fields.join(', ')}` : 'Updated';
}

/** Default `skill_versions.summary` for a restore — `"Restored from v{n}"`. */
export function restoreSummary(version: number): string {
  return `Restored from v${version}`;
}

// ---- name derivation --------------------------------------------------

/** Pull a name from the body's first `# Heading`, if present. */
export function deriveSkillNameFromBody(body: string): string | undefined {
  const match = body.match(/^#\s+(.+?)\s*$/m);
  return match?.[1]?.trim() || undefined;
}

/** Filename minus its archive/markdown extension (path-stripped). */
export function fileStem(filename: string): string {
  const base = basename(filename);
  const lower = base.toLowerCase();
  for (const ext of [...ARCHIVE_EXTENSIONS, ...ALLOWED_MARKDOWN_EXTENSIONS]) {
    if (lower.endsWith(ext)) return base.slice(0, base.length - ext.length);
  }
  return base;
}

// ---- file-type detection ------------------------------------------------

export function isMarkdownFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export type ArchiveKind = 'zip' | 'tar' | null;

/** Detect archive kind from a filename/URL path. `.tar.gz`/`.tgz`/`.tar` → 'tar'. */
export function detectArchiveKind(filename: string): ArchiveKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar')) return 'tar';
  return null;
}

// ---- archive → markdown extraction --------------------------------------

/** One file entry read out of an archive — content already in memory. */
export interface ArchiveFileEntry {
  /** Entry path as stored in the archive (forward-slash separated). */
  name: string;
  content: Buffer;
}

export interface ExtractedMarkdown {
  /** The chosen "main" markdown file's content, or '' if none was found. */
  body: string;
  /** The chosen main file's archive path, or undefined if none was found. */
  mainFile?: string;
  /** Other `.md`/`.markdown` entries besides the main file. */
  evidence_files: string[];
  /** Every non-markdown entry's name — read, never parsed as code or executed. */
  ignored_files: string[];
}

function isMarkdownEntry(name: string): boolean {
  return ALLOWED_MARKDOWN_EXTENSIONS.includes(extname(name).toLowerCase());
}

/**
 * Pick the "main" markdown file among an archive's file entries: a root-level
 * (no `/` in its path) markdown file named like the archive wins first,
 * then any root-level markdown file, then the first markdown file found at
 * any depth. Returns undefined if the archive has no markdown file at all.
 */
export function pickMainMarkdown(
  entries: ArchiveFileEntry[],
  archiveStem: string,
): ArchiveFileEntry | undefined {
  const mdFiles = entries.filter((e) => isMarkdownEntry(e.name));
  if (mdFiles.length === 0) return undefined;

  const stemLower = archiveStem.toLowerCase();
  const byStem = mdFiles.find(
    (e) => basename(e.name, extname(e.name)).toLowerCase() === stemLower,
  );
  if (byStem) return byStem;

  const rootLevel = mdFiles.filter((e) => !e.name.includes('/'));
  if (rootLevel.length > 0) return rootLevel[0];

  return mdFiles[0];
}

/**
 * Classify every archive entry: the main markdown file becomes `body`, any
 * OTHER `.md`/`.markdown` entries become `evidence_files`, and every
 * non-markdown entry's name goes into `ignored_files`. Never reads
 * non-markdown content as anything but bytes for the (unused) buffer — never
 * executed, required, or eval'd.
 */
export function extractMarkdownFromEntries(
  entries: ArchiveFileEntry[],
  archiveStem: string,
): ExtractedMarkdown {
  const main = pickMainMarkdown(entries, archiveStem);
  const evidence_files: string[] = [];
  const ignored_files: string[] = [];

  for (const entry of entries) {
    if (entry === main) continue;
    if (isMarkdownEntry(entry.name)) {
      evidence_files.push(entry.name);
    } else {
      ignored_files.push(entry.name);
    }
  }

  return {
    body: main ? main.content.toString('utf8') : '',
    mainFile: main?.name,
    evidence_files,
    ignored_files,
  };
}
