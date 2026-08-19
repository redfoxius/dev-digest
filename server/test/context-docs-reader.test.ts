import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONTEXT_GLOBS, discoverContextDocs } from '../src/modules/context-docs/reader.js';

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

    const docs = await discoverContextDocs(clonePath, DEFAULT_CONTEXT_GLOBS);
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

    const docs = await discoverContextDocs(clonePath, DEFAULT_CONTEXT_GLOBS);
    expect(docs.map((d) => d.path)).not.toContain('node_modules/pkg/README.md');
    expect(docs).toHaveLength(1);
  });

  it('root is derived purely from the matched path, never file content', async () => {
    clonePath = await makeClone({
      'docs/architecture.md': 'This document talks about specs and insights extensively.',
    });
    const docs = await discoverContextDocs(clonePath, DEFAULT_CONTEXT_GLOBS);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.root).toBe('docs');
  });

  it('scopes discovery to a custom configured glob', async () => {
    clonePath = await makeClone({
      'docs/a.md': '# A',
      'specs/b.md': '# B',
    });
    const docs = await discoverContextDocs(clonePath, ['docs/**/*.md']);
    expect(docs.map((d) => d.path)).toEqual(['docs/a.md']);
  });

  it('records size in bytes and a content hash that changes with content', async () => {
    clonePath = await makeClone({ 'docs/a.md': 'hello world' });
    const [doc] = await discoverContextDocs(clonePath, DEFAULT_CONTEXT_GLOBS);
    expect(doc!.sizeBytes).toBe(Buffer.byteLength('hello world'));
    expect(doc!.contentHash).toMatch(/^[0-9a-f]{64}$/);

    await writeFile(join(clonePath, 'docs', 'a.md'), 'hello world!!!');
    const [doc2] = await discoverContextDocs(clonePath, DEFAULT_CONTEXT_GLOBS);
    expect(doc2!.contentHash).not.toBe(doc!.contentHash);
  });

  it('returns an empty list for a repo with no matching documents', async () => {
    clonePath = await makeClone({ 'src/index.ts': 'export {}' });
    expect(await discoverContextDocs(clonePath, DEFAULT_CONTEXT_GLOBS)).toEqual([]);
  });
});
