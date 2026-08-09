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
  /** Human-readable name, e.g. for a review prompt's "languages touched" framing. */
  label: string;
  extensions: readonly string[];
  /**
   * True if `file` (a repo-relative path already known to belong to this
   * language) follows this language's own test-file naming convention —
   * e.g. Go's colocated `_test.go` suffix, which has no dot-based analog
   * (`.test.`/`.spec.`) for a substring rule to catch. Optional: a language
   * whose test files are already caught by a generic path-substring rule
   * (TS/JS's `.test.`/`.spec.`/`__tests__/`, checked independently of this
   * registry) doesn't need one. See `isLanguageTestFile` below and Phase
   * 7.5 of docs/go-language-support-plan.md (found via
   * `conventions-go.it.test.ts` empirically leaking `_test.go` files into
   * convention sampling before this existed).
   */
  isTestFile?(file: string): boolean;
}

export const LANGUAGES: readonly LanguageDef[] = [
  {
    id: 'typescript',
    label: 'TypeScript/JavaScript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  },
  {
    id: 'go',
    label: 'Go',
    extensions: ['.go'],
    isTestFile: (file) => file.endsWith('_test.go'),
  },
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

const LABEL_BY_ID: ReadonlyMap<string, string> = new Map(LANGUAGES.map((l) => [l.id, l.label]));

/** Human-readable label for a language id, falling back to the id itself. */
export function labelForLanguageId(id: string): string {
  return LABEL_BY_ID.get(id) ?? id;
}

const LANG_BY_ID: ReadonlyMap<string, LanguageDef> = new Map(LANGUAGES.map((l) => [l.id, l]));

/** True if `file` matches its own language's registered test-file naming
 *  convention (e.g. Go's `_test.go`). False for files whose language has no
 *  such convention registered — their test files are expected to be caught
 *  by a generic path-substring rule instead (e.g. TS/JS's `.test.`/
 *  `__tests__/`, which this function deliberately does not duplicate). */
export function isLanguageTestFile(file: string): boolean {
  const id = languageIdForFile(file);
  if (!id) return false;
  return LANG_BY_ID.get(id)?.isTestFile?.(file) ?? false;
}

/**
 * The distinct, sorted set of language ids present across `files` — e.g. for
 * persisting `repo_index_state.languages` (Phase 5). Files with no
 * recognized extension are silently excluded, same as everywhere else this
 * registry gates indexing.
 */
export function languagesPresent(files: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const f of files) {
    const id = languageIdForFile(f);
    if (id) ids.add(id);
  }
  return [...ids].sort();
}
