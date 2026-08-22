import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONTEXT_EXCLUDES, discoverContextDocs } from '../src/modules/context-docs/reader.js';

/**
 * Unit coverage for the Project Context Folder feature's file discovery
 * (`docs/project-context-folder-plan.md` Work Item 3, spec §6.1 AC-1–AC-4).
 * Real fs against a throwaway tmpdir fixture — no DB.
 */
describe('discoverContextDocs', () => {
  let clonePath: string;

  afterEach(async () => {
    if (clonePath) await rm(clonePath, { recursive: true, force: true });
  });

  async function makeClone(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'devdigest-context-docs-'));
    for (const [rel, content] of Object.entries(files)) {
      const full = join(root, ...rel.split('/'));
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, content);
    }
    return root;
  }

  it('discovers markdown files across specs/docs/insights with correct root classification', async () => {
    clonePath = await makeClone({
      'specs/a.md': '# A',
      'specs/nested/b.md': '# B',
      'docs/c.md': '# C',
      'docs/nested/d.md': '# D',
      'insights/e.md': '# E',
      'insights/nested/f.md': '# F',
    });

    const docs = await discoverContextDocs(clonePath, DEFAULT_CONTEXT_EXCLUDES);
    expect(docs).toHaveLength(6);

    const byPath = new Map(docs.map((d) => [d.path, d]));
    expect(byPath.get('specs/a.md')?.root).toBe('specs');
    expect(byPath.get('specs/nested/b.md')?.root).toBe('specs');
    expect(byPath.get('docs/c.md')?.root).toBe('docs');
    expect(byPath.get('docs/nested/d.md')?.root).toBe('docs');
    expect(byPath.get('insights/e.md')?.root).toBe('insights');
    expect(byPath.get('insights/nested/f.md')?.root).toBe('insights');
  });

  it('excludes node_modules regardless of content', async () => {
    clonePath = await makeClone({
      'specs/a.md': '# A',
      'node_modules/pkg/README.md': '# should never appear',
    });

    const docs = await discoverContextDocs(clonePath, DEFAULT_CONTEXT_EXCLUDES);
    expect(docs.map((d) => d.path)).not.toContain('node_modules/pkg/README.md');
    expect(docs).toHaveLength(1);
  });

  it('root is derived purely from the matched path, never file content', async () => {
    clonePath = await makeClone({
      'docs/architecture.md': 'This document talks about specs and insights extensively.',
    });
    const docs = await discoverContextDocs(clonePath, DEFAULT_CONTEXT_EXCLUDES);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.root).toBe('docs');
  });

  it('excludes files matching a custom configured exclude pattern', async () => {
    clonePath = await makeClone({
      'docs/a.md': '# A',
      'specs/b.md': '# B',
    });
    const docs = await discoverContextDocs(clonePath, ['docs/**/*.md']);
    expect(docs.map((d) => d.path)).toEqual(['specs/b.md']);
  });

  it('records size in bytes and a content hash that changes with content', async () => {
    clonePath = await makeClone({ 'docs/a.md': 'hello world' });
    const [doc] = await discoverContextDocs(clonePath, DEFAULT_CONTEXT_EXCLUDES);
    expect(doc!.sizeBytes).toBe(Buffer.byteLength('hello world'));
    expect(doc!.contentHash).toMatch(/^[0-9a-f]{64}$/);

    await writeFile(join(clonePath, 'docs', 'a.md'), 'hello world!!!');
    const [doc2] = await discoverContextDocs(clonePath, DEFAULT_CONTEXT_EXCLUDES);
    expect(doc2!.contentHash).not.toBe(doc!.contentHash);
  });

  it('returns an empty list for a repo with no matching documents', async () => {
    clonePath = await makeClone({ 'src/index.ts': 'export {}' });
    expect(await discoverContextDocs(clonePath, DEFAULT_CONTEXT_EXCLUDES)).toEqual([]);
  });

  describe('AC-43: default exclude set — broader fixture coverage', () => {
    it('excludes a nested AGENTS.md and multiple .claude/ subpaths, keeps README.md and .github/**', async () => {
      clonePath = await makeClone({
        'README.md': '# Readme',
        '.github/workflows/notes.md': '# CI notes',
        'docs/AGENTS.md': '# Nested agent instructions',
        '.claude/skills/foo/SKILL.md': '# Skill body',
        '.claude/agents/bar.md': '# Agent body',
      });

      const docs = await discoverContextDocs(clonePath, DEFAULT_CONTEXT_EXCLUDES);
      const paths = new Set(docs.map((d) => d.path));
      expect(paths).toEqual(new Set(['README.md', '.github/workflows/notes.md']));
    });

    it('excludes a real (non-symlink) CLAUDE.md file via the exclude pattern itself', async () => {
      // This repo's own package-root CLAUDE.md files are symlinks, which the
      // walker already skips structurally (`entry.isSymbolicLink()` continue,
      // reader.ts:130) for a reason unrelated to exclude-pattern matching. A
      // real (regular-file) CLAUDE.md — as a cloned target repo could easily
      // have, unrelated to this codebase's own symlink convention — must
      // still be excluded by the `**/CLAUDE.md` pattern itself, not merely by
      // accident of symlink-skipping. `writeFile` below creates an ordinary
      // regular file, isolating that distinction.
      clonePath = await makeClone({
        'CLAUDE.md': '# Real, non-symlink CLAUDE.md',
        'README.md': '# Readme',
      });

      const docs = await discoverContextDocs(clonePath, DEFAULT_CONTEXT_EXCLUDES);
      expect(docs.map((d) => d.path)).toEqual(['README.md']);
    });
  });

  describe('AC-44: real gitignore semantics via the `ignore` package', () => {
    it('a `**`-anchored pattern excludes a matching filename at any depth', async () => {
      clonePath = await makeClone({
        'tmp.md': '# root tmp',
        'a/tmp.md': '# nested tmp',
        'a/b/tmp.md': '# deeply nested tmp',
        'a/keep.md': '# keep',
      });

      const docs = await discoverContextDocs(clonePath, ['**/tmp.md']);
      expect(docs.map((d) => d.path)).toEqual(['a/keep.md']);
    });

    it('a pattern containing an interior slash is anchored to the repo root, not any nested occurrence', async () => {
      // Per real gitignore semantics, a pattern with a slash other than a
      // trailing one is anchored to the root of the ignore file — unlike a
      // naive flat/substring glob match, `docs/anchor.md` must NOT also
      // exclude `sub/docs/anchor.md`.
      clonePath = await makeClone({
        'docs/anchor.md': '# root-anchored',
        'sub/docs/anchor.md': '# nested, same basename+parent-name, must survive',
      });

      const docs = await discoverContextDocs(clonePath, ['docs/anchor.md']);
      expect(docs.map((d) => d.path)).toEqual(['sub/docs/anchor.md']);
    });

    it('multiple negation patterns re-include specific nested files (one two levels deep) an earlier pattern excluded', async () => {
      clonePath = await makeClone({
        'docs/keep-top.md': '# re-included at depth 1',
        'docs/other.md': '# stays excluded',
        'docs/sub/keep-nested.md': '# re-included at depth 2',
        'docs/sub/other2.md': '# stays excluded',
      });

      // Real gitignore semantics (not a flat/order-independent match) require
      // BOTH the intermediate directory (`docs/sub`) and the file itself to
      // be negated to re-include something two levels deep — negating only
      // the file is not enough, because `docs/**` already excludes the
      // `docs/sub` directory and gitignore never re-descends into an
      // excluded directory just because a path inside it is later negated.
      const docs = await discoverContextDocs(clonePath, [
        'docs/**',
        '!docs/keep-top.md',
        '!docs/sub',
        '!docs/sub/keep-nested.md',
      ]);
      const paths = new Set(docs.map((d) => d.path));
      expect(paths).toEqual(new Set(['docs/keep-top.md', 'docs/sub/keep-nested.md']));
    });
  });
});
