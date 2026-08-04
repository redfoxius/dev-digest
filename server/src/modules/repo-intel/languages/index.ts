/**
 * Language registry — the single source of truth for "which file extensions
 * does repo-intel index at all." Replaces what used to be three independently
 * maintained copies of the same allowlist (repo-intel/constants.ts,
 * adapters/codeindex/ripgrep.ts, adapters/astgrep/index.ts's SUPPORTED_EXT
 * re-import) — the "added a language to one allowlist, forgot the other two"
 * risk this closes.
 *
 * Extension-level only: this does NOT decide which ast-grep grammar or which
 * concrete parser module handles a file — that's `adapters/astgrep/index.ts`'s
 * job (it needs finer-grained info than a language id, e.g. TS vs Tsx vs JS
 * per extension). This registry answers exactly one question: is this
 * extension indexed at all, and which language bucket does it belong to.
 */
import { extname } from 'node:path';

export interface LanguageDef {
  id: string;
  extensions: readonly string[];
}

export const LANGUAGES: readonly LanguageDef[] = [
  { id: 'typescript', extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] },
  { id: 'go', extensions: ['.go'] },
];

/** Flattened list of every indexed extension, across every language. */
export const SUPPORTED_EXT: readonly string[] = LANGUAGES.flatMap((l) => l.extensions);

export const SUPPORTED_EXT_SET: ReadonlySet<string> = new Set(SUPPORTED_EXT);

const LANG_BY_EXT: ReadonlyMap<string, string> = new Map(
  LANGUAGES.flatMap((l) => l.extensions.map((ext) => [ext, l.id] as const)),
);

/** Language id for a file's extension, or null when it's not indexed. */
export function languageIdForFile(file: string): string | null {
  return LANG_BY_EXT.get(extname(file).toLowerCase()) ?? null;
}
