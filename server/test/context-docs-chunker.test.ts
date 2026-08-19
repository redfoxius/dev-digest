import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from '../src/modules/context-docs/chunker.js';

/**
 * Unit coverage for the Project Context Folder feature's pure markdown
 * chunker (`docs/project-context-folder-plan.md` Work Item 5, spec §9's
 * heading-based/~500-token-fallback chunking strategy). No DB/FS.
 */
describe('chunkMarkdown', () => {
  it('returns one chunk per heading section', () => {
    const text = ['# Title', 'Intro text.', '', '## Section A', 'Body A.', '', '## Section B', 'Body B.'].join(
      '\n',
    );
    const chunks = chunkMarkdown(text);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toContain('# Title');
    expect(chunks[1]).toContain('## Section A');
    expect(chunks[2]).toContain('## Section B');
  });

  it('treats a heading-less document as a single section', () => {
    const text = 'Just some prose with no headings at all.';
    expect(chunkMarkdown(text)).toEqual([text]);
  });

  it('returns zero chunks for empty/whitespace-only input', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n\n  ')).toEqual([]);
  });

  it('splits a section exceeding ~500 tokens into fixed-size windows', () => {
    // ~500 tokens ≈ 2000 chars (chars/4 heuristic) — well over one window.
    const bigSection = '# Big Section\n' + 'x'.repeat(5000);
    const chunks = chunkMarkdown(bigSection);
    expect(chunks.length).toBeGreaterThan(1);
    // Every window (except possibly the last) stays within the ~500-token
    // (2000-char) budget.
    for (const c of chunks.slice(0, -1)) {
      expect(c.length).toBeLessThanOrEqual(2000);
    }
  });

  it('does not window-split a heading-less document under the token budget', () => {
    const text = '# H\nshort body';
    expect(chunkMarkdown(text)).toHaveLength(1);
  });
});
