import { typescriptPack } from './typescript.js';
import { goPack } from './go.js';
import type { ConfigCandidateDraft, ConventionLangPack } from './types.js';

export type { ConfigCandidateDraft, ConventionLangPack } from './types.js';

/**
 * Every registered convention pack. Adding a language means adding one pack
 * here — see docs/go-language-support-plan.md Phase 7.1/7.2. Not yet keyed
 * off `repo-intel/languages/index.ts`'s `LANGUAGES` array directly (config
 * filenames like `tsconfig.json`/`go.mod` aren't source-file extensions, so
 * there's no single lookup table shared between the two registries) — each
 * pack's `id` matches that registry's language ids so Phase 7.4 can reuse
 * the same vocabulary once `ConventionCandidate` gains a `language` field.
 */
export const CONVENTION_LANG_PACKS: readonly ConventionLangPack[] = [typescriptPack, goPack];

/** Every config filename any registered pack probes for, flattened. */
export function allConfigFileCandidates(): string[] {
  return CONVENTION_LANG_PACKS.flatMap((p) => p.configFileCandidates);
}

/** Route a config file's content through whichever pack's parser recognizes
 *  its filename. Unrecognized filenames yield no candidates. */
export function parseConfigFile(filePath: string, content: string): ConfigCandidateDraft[] {
  const base = filePath.split('/').pop() ?? filePath;
  for (const pack of CONVENTION_LANG_PACKS) {
    if (pack.matchesConfigFile(base)) return pack.parseConfigFile(filePath, content);
  }
  return [];
}
