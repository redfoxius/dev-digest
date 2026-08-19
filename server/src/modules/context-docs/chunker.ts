import { estimateTokens } from '@devdigest/reviewer-core';

/**
 * Project Context Folder — heading-based markdown chunker (spec §9's
 * chunking-strategy decision, `docs/project-context-folder-plan.md` Work
 * Item 5). Pure: input text in, chunk strings out — no DB/FS, so it's
 * hermetically unit-testable and reusable from `service.ts`'s reindex path
 * without a container.
 *
 * Strategy: split on markdown headings (`#`..`######`); each heading section
 * becomes one chunk. A section (or a heading-less document) exceeding ~500
 * tokens is further split into fixed-size ~500-token windows, using the
 * same chars/4 heuristic `reviewer-core`'s `estimateTokens` already uses
 * elsewhere in this codebase (no real tokenizer call — see its own doc
 * comment).
 */

const TOKEN_WINDOW = 500;
// chars/4 heuristic in reverse: chars ~= tokens * 4.
const CHAR_WINDOW = TOKEN_WINDOW * 4;

const HEADING_RE = /^#{1,6}\s+.+$/;

/** Split markdown into heading-delimited sections; a heading-less document
 *  (or its text before the first heading) is its own leading section. */
function splitByHeadings(text: string): string[] {
  const lines = text.split('\n');
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (HEADING_RE.test(line) && current.length > 0) {
      sections.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) sections.push(current.join('\n'));

  return sections.length > 0 ? sections : [text];
}

/** Splits one section into fixed ~500-token windows only if it's oversized;
 *  returns the section unchanged (as a single-element array) otherwise. */
function windowSplit(section: string): string[] {
  if (estimateTokens(section.length) <= TOKEN_WINDOW) return [section];

  const windows: string[] = [];
  for (let i = 0; i < section.length; i += CHAR_WINDOW) {
    windows.push(section.slice(i, i + CHAR_WINDOW));
  }
  return windows;
}

/**
 * Chunk a markdown document's full text into heading-based (+ ~500-token
 * fallback windowed) chunks, dropping any resulting blank/whitespace-only
 * chunk. Empty/whitespace-only input yields zero chunks.
 */
export function chunkMarkdown(text: string): string[] {
  if (text.trim().length === 0) return [];
  return splitByHeadings(text)
    .flatMap(windowSplit)
    .filter((chunk) => chunk.trim().length > 0);
}
