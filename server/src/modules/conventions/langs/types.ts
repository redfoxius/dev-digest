import type { ConventionCategory } from '@devdigest/shared';

/**
 * Per-language convention packs — Phase 7.1 of docs/go-language-support-plan.md.
 * Mirrors the `astgrep/langs/{typescript,go}.ts` split: each language owns its
 * own config-file probe list + parser instead of one JS/TS-only allowlist
 * (the original `CONFIG_FILE_CANDIDATES`/`parseConfigFile` in constants.ts/
 * helpers.ts, which had zero non-JS equivalent). `id` matches the language id
 * from `server/src/modules/repo-intel/languages/index.ts` (`'typescript'`,
 * `'go'`, ...) — a shared vocabulary, not a re-derived one — so Phase 7.4's
 * `language` field on `ConventionCandidate` can reuse the same ids.
 */

export interface ConfigCandidateDraft {
  rule: string;
  category: ConventionCategory;
  evidence_path: string;
  evidence_snippet: string;
  evidence_line_start: number;
  evidence_line_end: number;
  confidence: 1;
}

export interface ConventionLangPack {
  /** Language id, matching `repo-intel/languages/index.ts`'s `LanguageDef.id`. */
  id: string;
  /** Root-relative config filenames this pack probes for during extraction. */
  configFileCandidates: readonly string[];
  /** True if `base` (a bare filename, no directory) is a config file this pack parses. */
  matchesConfigFile(base: string): boolean;
  /** Parse one config file's content into config-derived candidate drafts. */
  parseConfigFile(filePath: string, content: string): ConfigCandidateDraft[];
}
