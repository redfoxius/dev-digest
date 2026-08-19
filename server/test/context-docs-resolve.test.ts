import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveContextDocs, MAX_SPEC_CHARS } from '../src/modules/context-docs/resolve.js';

/**
 * Unit coverage for run-time Project Context resolution (spec §6.7,
 * `docs/project-context-folder-plan.md` Work Item 10, AC-12/AC-26–AC-33/
 * AC-39). Hermetic: a real temp-dir "clone" for raw fs reads (mirroring
 * `readPreviewContent`'s own contract), a fake `Container` exposing only
 * `agentsRepo`/`skillsRepo` — never `code_chunks`/`Embedder`.
 */

function fakeContainer(overrides: {
  linkedContextDocs?: unknown[];
  linkedSkills?: unknown[];
  skillContextDocsByskillId?: Record<string, unknown[]>;
}) {
  const embedderSpy = vi.fn();
  const contextDocsRepoSpy = { listByRepo: vi.fn() }; // code_chunks-adjacent catalog — must stay untouched

  return {
    embedder: embedderSpy,
    contextDocsRepo: contextDocsRepoSpy,
    agentsRepo: {
      linkedContextDocs: vi.fn().mockResolvedValue(overrides.linkedContextDocs ?? []),
      linkedSkills: vi.fn().mockResolvedValue(overrides.linkedSkills ?? []),
    },
    skillsRepo: {
      skillContextDocs: vi.fn().mockImplementation((skillId: string) =>
        Promise.resolve(overrides.skillContextDocsByskillId?.[skillId] ?? []),
      ),
    },
  } as never;
}

function linkedSkillRow(skillId: string, order: number, linkEnabled = true, skillEnabled = true) {
  return { skill: { id: skillId, enabled: skillEnabled }, order, enabled: linkEnabled };
}

describe('resolveContextDocs', () => {
  let clonePath: string;

  beforeEach(() => {
    clonePath = mkdtempSync(join(tmpdir(), 'devdigest-context-docs-'));
  });

  afterEach(() => {
    rmSync(clonePath, { recursive: true, force: true });
  });

  function write(relPath: string, content: string) {
    const abs = join(clonePath, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }

  it('resolves the agent\'s own docs (in order) then a linked skill\'s docs, via raw reads only', async () => {
    write('specs/a.md', 'A content');
    write('specs/b.md', 'B content');
    write('docs/skill-doc.md', 'Skill doc content');

    const container = fakeContainer({
      linkedContextDocs: [
        { path: 'specs/a.md', order: 0, enabled: true },
        { path: 'specs/b.md', order: 1, enabled: true },
      ],
      linkedSkills: [linkedSkillRow('skill-1', 0)],
      skillContextDocsByskillId: {
        'skill-1': [{ path: 'docs/skill-doc.md', order: 0, enabled: true }],
      },
    });

    const result = await resolveContextDocs('agent-1', 'repo-1', clonePath, container);

    expect(result.specsRead).toEqual(['specs/a.md', 'specs/b.md', 'docs/skill-doc.md']);
    expect(result.specs[0]).toBe('### specs/a.md\n\nA content');
    expect(result.specs[1]).toBe('### specs/b.md\n\nB content');
    expect(result.specs[2]).toBe('### docs/skill-doc.md\n\nSkill doc content');
    expect(result.warnings).toEqual([]);

    // AC-12/AC-39 — never touches the chunk/embedding mechanism.
    expect((container as { embedder: ReturnType<typeof vi.fn> }).embedder).not.toHaveBeenCalled();
    expect(
      (container as { contextDocsRepo: { listByRepo: ReturnType<typeof vi.fn> } }).contextDocsRepo.listByRepo,
    ).not.toHaveBeenCalled();
  });

  it('excludes a disabled agent-level link, a disabled skill link, and a globally-disabled skill', async () => {
    write('specs/a.md', 'A');
    write('specs/off.md', 'OFF');
    write('docs/skill-doc.md', 'SKILL');

    const container = fakeContainer({
      linkedContextDocs: [
        { path: 'specs/a.md', order: 0, enabled: true },
        { path: 'specs/off.md', order: 1, enabled: false },
      ],
      linkedSkills: [
        linkedSkillRow('skill-disabled-link', 0, false, true),
        linkedSkillRow('skill-globally-off', 1, true, false),
      ],
      skillContextDocsByskillId: {
        'skill-disabled-link': [{ path: 'docs/skill-doc.md', order: 0, enabled: true }],
        'skill-globally-off': [{ path: 'docs/skill-doc.md', order: 0, enabled: true }],
      },
    });

    const result = await resolveContextDocs('agent-1', 'repo-1', clonePath, container);

    expect(result.specsRead).toEqual(['specs/a.md']);
  });

  it('de-dups the same path attached at both agent and skill level, keeping the agent-level position', async () => {
    write('specs/shared.md', 'SHARED');
    write('specs/only-agent.md', 'AGENT ONLY');

    const container = fakeContainer({
      linkedContextDocs: [
        { path: 'specs/only-agent.md', order: 0, enabled: true },
        { path: 'specs/shared.md', order: 1, enabled: true },
      ],
      linkedSkills: [linkedSkillRow('skill-1', 0)],
      skillContextDocsByskillId: {
        'skill-1': [{ path: 'specs/shared.md', order: 0, enabled: true }],
      },
    });

    const result = await resolveContextDocs('agent-1', 'repo-1', clonePath, container);

    expect(result.specsRead).toEqual(['specs/only-agent.md', 'specs/shared.md']);
    expect(result.specs).toHaveLength(2);
  });

  it('truncates a document over 12,000 characters to exactly 12,000 + the marker', async () => {
    const longContent = 'x'.repeat(MAX_SPEC_CHARS + 500);
    write('specs/long.md', longContent);

    const container = fakeContainer({
      linkedContextDocs: [{ path: 'specs/long.md', order: 0, enabled: true }],
    });

    const result = await resolveContextDocs('agent-1', 'repo-1', clonePath, container);

    const body = result.specs[0]!.slice('### specs/long.md\n\n'.length);
    expect(body).toBe('x'.repeat(MAX_SPEC_CHARS) + '...[truncated]');
  });

  it('does not truncate a document at or under the cap', async () => {
    const content = 'y'.repeat(MAX_SPEC_CHARS);
    write('specs/exact.md', content);

    const container = fakeContainer({
      linkedContextDocs: [{ path: 'specs/exact.md', order: 0, enabled: true }],
    });

    const result = await resolveContextDocs('agent-1', 'repo-1', clonePath, container);

    expect(result.specs[0]).toBe(`### specs/exact.md\n\n${content}`);
  });

  it('skips a missing/deleted attached file, warns naming the path, and still resolves the rest', async () => {
    write('specs/present.md', 'PRESENT');
    // 'specs/missing.md' intentionally never written.

    const container = fakeContainer({
      linkedContextDocs: [
        { path: 'specs/missing.md', order: 0, enabled: true },
        { path: 'specs/present.md', order: 1, enabled: true },
      ],
    });

    const result = await resolveContextDocs('agent-1', 'repo-1', clonePath, container);

    expect(result.specsRead).toEqual(['specs/present.md']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('specs/missing.md');
  });

  it('skips a path-escaping attached entry defensively, without throwing', async () => {
    const container = fakeContainer({
      linkedContextDocs: [{ path: '../../etc/passwd', order: 0, enabled: true }],
    });

    const result = await resolveContextDocs('agent-1', 'repo-1', clonePath, container);

    expect(result.specs).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('../../etc/passwd');
  });

  it('returns empty (no repo calls) when clonePath is null — repo never cloned/indexed', async () => {
    const container = fakeContainer({ linkedContextDocs: [{ path: 'specs/a.md', order: 0, enabled: true }] });

    const result = await resolveContextDocs('agent-1', 'repo-1', null, container);

    expect(result).toEqual({ specs: [], specsRead: [], warnings: [] });
    expect(
      (container as { agentsRepo: { linkedContextDocs: ReturnType<typeof vi.fn> } }).agentsRepo.linkedContextDocs,
    ).not.toHaveBeenCalled();
  });

  it('security regression: skips a symlink that resolves outside clonePath instead of injecting its target content', async () => {
    // Regression guard for the CRITICAL finding from pr-self-review's
    // security review of PR #21: an attached path is never required to
    // already be a discovered `context_documents` row (AC-22 allows
    // attaching before discovery), and `reader.ts`'s own scan deliberately
    // skips symlinks — so nothing before this point would ever reject a
    // hand-crafted `agent_context_docs` row pointing at a tracked symlink.
    // Without the read-time realpath check, this would have read
    // `secret.md`'s content and injected it into the LLM prompt via
    // `specs`, wrongly labeled `### docs/evil.md`.
    const outsideDir = mkdtempSync(join(tmpdir(), 'devdigest-resolve-outside-'));
    const secretFile = join(outsideDir, 'secret.md');
    writeFileSync(secretFile, 'TOP SECRET — outside the clone', 'utf8');
    mkdirSync(join(clonePath, 'docs'), { recursive: true });
    symlinkSync(secretFile, join(clonePath, 'docs', 'evil.md'));
    write('specs/legit.md', 'legit content');

    const container = fakeContainer({
      linkedContextDocs: [
        { path: 'docs/evil.md', order: 0, enabled: true },
        { path: 'specs/legit.md', order: 1, enabled: true },
      ],
    });

    const result = await resolveContextDocs('agent-1', 'repo-1', clonePath, container);

    expect(result.specsRead).toEqual(['specs/legit.md']);
    expect(result.specs).toHaveLength(1);
    expect(result.specs.join('\n')).not.toContain('TOP SECRET');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('docs/evil.md');

    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('AC-12 regression: succeeds and injects full text for documents never indexed/embedded, Embedder at call count 0', async () => {
    write('specs/never-indexed.md', 'This document was never chunked or embedded.');

    const container = fakeContainer({
      linkedContextDocs: [{ path: 'specs/never-indexed.md', order: 0, enabled: true }],
    });

    const result = await resolveContextDocs('agent-1', 'repo-1', clonePath, container);

    expect(result.specs).toEqual(['### specs/never-indexed.md\n\nThis document was never chunked or embedded.']);
    expect((container as { embedder: ReturnType<typeof vi.fn> }).embedder).toHaveBeenCalledTimes(0);
  });
});
