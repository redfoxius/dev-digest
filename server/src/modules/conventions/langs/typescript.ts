import type { ConventionCategory } from '@devdigest/shared';
import { findKeyLine, extractBracedBlockAfter, parseSimpleKeyValueBlock } from './shared.js';
import type { ConfigCandidateDraft, ConventionLangPack } from './types.js';

/**
 * TypeScript/JavaScript convention pack — Decision 10's deterministic
 * config-rule parsers (docs/conventions-extractor-plan.md), ported 1:1 out
 * of `conventions/constants.ts`/`helpers.ts` for Phase 7.1 of
 * docs/go-language-support-plan.md. Behavior is unchanged; only the module
 * boundary moved (verified by the existing `conventions.test.ts` suite
 * passing unmodified in assertions, only import paths updated).
 */

const CONFIG_FILE_CANDIDATES = [
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
] as const;

/** ESLint rule name → convention category. Unmapped enforced rules fall back
 *  to `'formatting'`. */
const ESLINT_RULE_CATEGORY_MAP: Record<string, ConventionCategory> = {
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

const TSCONFIG_STRICT_FLAGS: Record<string, string> = {
  strict: 'TypeScript strict mode is enabled — write fully-typed code, no implicit any.',
  noImplicitAny: 'noImplicitAny is enforced — do not add untyped `any` parameters.',
  noUnusedLocals: 'noUnusedLocals is enforced — remove unused local variables/imports.',
  noUncheckedIndexedAccess:
    'noUncheckedIndexedAccess is enforced — treat indexed array/object access as possibly undefined.',
};

/** `tsconfig.json`'s `compilerOptions` → one `'type-safety'` candidate per
 *  enforced strictness flag actually present and `true`. JSON.parse only. */
export function parseTsconfigStrictness(content: string, filePath: string): ConfigCandidateDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const compilerOptions = (parsed as { compilerOptions?: Record<string, unknown> } | null)
    ?.compilerOptions;
  if (!compilerOptions || typeof compilerOptions !== 'object') return [];

  const out: ConfigCandidateDraft[] = [];
  for (const [flag, ruleText] of Object.entries(TSCONFIG_STRICT_FLAGS)) {
    if (compilerOptions[flag] !== true) continue;
    const loc = findKeyLine(content, flag);
    out.push({
      rule: ruleText,
      category: 'type-safety',
      evidence_path: filePath,
      evidence_snippet: loc?.text ?? `"${flag}": true`,
      evidence_line_start: loc?.line ?? 1,
      evidence_line_end: loc?.line ?? 1,
      confidence: 1,
    });
  }
  return out;
}

function isEslintRuleValueEnforced(value: unknown): boolean {
  if (value === 'error' || value === 2) return true;
  if (Array.isArray(value) && value.length > 0) return isEslintRuleValueEnforced(value[0]);
  return false;
}

function buildEslintCandidate(ruleName: string, filePath: string, content: string): ConfigCandidateDraft {
  const category = ESLINT_RULE_CATEGORY_MAP[ruleName] ?? 'formatting';
  const loc = findKeyLine(content, ruleName);
  return {
    rule: `ESLint rule \`${ruleName}\` is enforced as an error — code must comply.`,
    category,
    evidence_path: filePath,
    evidence_snippet: loc?.text ?? ruleName,
    evidence_line_start: loc?.line ?? 1,
    evidence_line_end: loc?.line ?? 1,
    confidence: 1,
  };
}

/** `.eslintrc*`/`eslint.config.*` `rules` → one candidate per rule enforced
 *  as `"error"`/`2` (warn/off/0/1 skipped — v1 only surfaces enforced rules).
 *  JSON-shaped configs via `JSON.parse`; flat `.js`/`.mjs`/`.cjs` configs via
 *  brace-matched text extraction of the `rules: {...}` block + a regex scan
 *  of its entries — never evaluated as code. */
export function parseEslintRules(content: string, filePath: string): ConfigCandidateDraft[] {
  try {
    const parsed = JSON.parse(content);
    const rules = (parsed as { rules?: Record<string, unknown> } | null)?.rules;
    if (rules && typeof rules === 'object') {
      const out: ConfigCandidateDraft[] = [];
      for (const [ruleName, value] of Object.entries(rules)) {
        if (!isEslintRuleValueEnforced(value)) continue;
        out.push(buildEslintCandidate(ruleName, filePath, content));
      }
      return out;
    }
  } catch {
    // Not JSON — fall through to flat-config text extraction below.
  }

  const rulesBlock = extractBracedBlockAfter(content, /\brules\b\s*:/);
  if (!rulesBlock) return [];

  const out: ConfigCandidateDraft[] = [];
  const entryRe = /['"]([\w@/.-]+)['"]\s*:\s*\[?\s*(?:['"](error|warn|off)['"]|([0-2]))/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(rulesBlock))) {
    const ruleName = m[1]!;
    const level = m[2];
    const numLevel = m[3];
    const enforced = level === 'error' || numLevel === '2';
    if (!enforced) continue;
    out.push(buildEslintCandidate(ruleName, filePath, content));
  }
  return out;
}

const PRETTIER_KEYS = ['semi', 'singleQuote', 'printWidth', 'trailingComma', 'tabWidth'] as const;

/** `.prettierrc*`/`prettier.config.*` → one `'formatting'` candidate per key
 *  in `PRETTIER_KEYS` actually present (no candidate for unset keys — those
 *  are prettier defaults the repo never explicitly chose). JSON-shaped
 *  configs via `JSON.parse`; flat `.js`/`.mjs` configs via brace-matched text
 *  extraction of the exported object — never evaluated as code. */
export function parsePrettierConfig(content: string, filePath: string): ConfigCandidateDraft[] {
  let obj: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
  } catch {
    const block = extractBracedBlockAfter(content, /module\.exports|export\s+default/);
    if (block) obj = parseSimpleKeyValueBlock(block);
  }
  if (!obj) return [];

  const out: ConfigCandidateDraft[] = [];
  for (const key of PRETTIER_KEYS) {
    if (!(key in obj)) continue;
    const value = obj[key];
    const loc = findKeyLine(content, key);
    out.push({
      rule: `Prettier \`${key}\` is set to \`${JSON.stringify(value)}\` — formatting must match.`,
      category: 'formatting',
      evidence_path: filePath,
      evidence_snippet: loc?.text ?? `${key}: ${JSON.stringify(value)}`,
      evidence_line_start: loc?.line ?? 1,
      evidence_line_end: loc?.line ?? 1,
      confidence: 1,
    });
  }
  return out;
}

function matchesConfigFile(base: string): boolean {
  return (
    base === 'tsconfig.json' ||
    /^tsconfig\..*\.json$/.test(base) ||
    base.startsWith('.eslintrc') ||
    base.startsWith('eslint.config.') ||
    base.startsWith('.prettierrc') ||
    base.startsWith('prettier.config.')
  );
}

/** Route a config file's content through the right deterministic parser by
 *  filename. Unrecognized filenames yield no candidates. */
function parseConfigFile(filePath: string, content: string): ConfigCandidateDraft[] {
  const base = filePath.split('/').pop() ?? filePath;
  if (base === 'tsconfig.json' || /^tsconfig\..*\.json$/.test(base)) {
    return parseTsconfigStrictness(content, filePath);
  }
  if (base.startsWith('.eslintrc') || base.startsWith('eslint.config.')) {
    return parseEslintRules(content, filePath);
  }
  if (base.startsWith('.prettierrc') || base.startsWith('prettier.config.')) {
    return parsePrettierConfig(content, filePath);
  }
  return [];
}

export const typescriptPack: ConventionLangPack = {
  id: 'typescript',
  configFileCandidates: CONFIG_FILE_CANDIDATES,
  matchesConfigFile,
  parseConfigFile,
};
