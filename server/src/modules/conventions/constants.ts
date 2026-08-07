import { ConventionCategory } from '@devdigest/shared';

/** Constants for the conventions module. See docs/conventions-extractor-plan.md. */

/** The fixed category vocabulary (mirrors the shared `ConventionCategory` enum). */
export const CONVENTION_CATEGORIES = ConventionCategory.options;

/** Top-N ranked files sampled per extraction, via `repoIntel.getConventionSamples`. */
export const SAMPLE_FILE_COUNT = 12;

/** Root-relative config filenames probed for Decision 10's deterministic pass. */
export const CONFIG_FILE_CANDIDATES = [
  'tsconfig.json',
  '.eslintrc.json',
  '.eslintrc',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'prettier.config.js',
  'prettier.config.mjs',
];

/** Fuzzy line-window match threshold (token-overlap ratio) for evidence verification. */
export const EVIDENCE_FUZZY_THRESHOLD = 0.9;

/** ESLint rule name → convention category, for Decision 10's deterministic pass.
 *  Unmapped enforced rules fall back to `'formatting'`. */
export const ESLINT_RULE_CATEGORY_MAP: Record<string, (typeof CONVENTION_CATEGORIES)[number]> = {
  '@typescript-eslint/no-explicit-any': 'type-safety',
  '@typescript-eslint/no-unused-vars': 'type-safety',
  '@typescript-eslint/explicit-function-return-type': 'type-safety',
  'no-console': 'error-handling',
  'no-unused-vars': 'error-handling',
  'import/order': 'imports',
  'import/no-cycle': 'imports',
  'no-restricted-imports': 'imports',
  camelcase: 'naming',
  'id-length': 'naming',
  'no-eval': 'security',
  'no-implied-eval': 'security',
};

/** Values that mark an ESLint rule as actively enforced (vs 'warn'/'off'/0/1). */
export const ESLINT_ENFORCED_VALUES = new Set<unknown>(['error', 2]);
