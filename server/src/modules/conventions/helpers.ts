import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionStatus,
  ConventionOrigin,
} from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';
import { EVIDENCE_FUZZY_THRESHOLD, ESLINT_RULE_CATEGORY_MAP } from './constants.js';

/**
 * Pure helpers for the conventions module — DB row ⇄ DTO mapping, the
 * code-only evidence-verification algorithm, and Decision 10's deterministic
 * config-rule parsers. No I/O (service.ts owns the clone reads/LLM call) so
 * everything here is unit-testable without a DB or a model.
 * See docs/conventions-extractor-plan.md.
 */

// ---- DB row ⇄ DTO -----------------------------------------------------

export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    rule: row.rule,
    category: (row.category ?? 'architecture') as ConventionCategory,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    evidence_line_start: row.evidenceLineStart ?? null,
    evidence_line_end: row.evidenceLineEnd ?? null,
    confidence: row.confidence ?? 0,
    status: row.status as ConventionStatus,
    origin: row.origin as ConventionOrigin,
  };
}

// ---- rule text helpers --------------------------------------------------

/** Lowercase, hyphenated, capped slug for a `##` skill-body heading. */
export function slugifyRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** One `##` section per candidate: heading = rule slug, body = rule text +
 *  fenced evidence snippet + "Detected in `file:line`". Matches the
 *  "Create skill from conventions" modal's generated preview. */
export function buildSkillBody(name: string, candidates: ConventionCandidate[]): string {
  const sections = candidates.map((c) => {
    const lineRef = lineRefFor(c);
    const lines = [
      `## ${slugifyRule(c.rule) || 'rule'}`,
      '',
      c.rule,
      '',
      `Detected in \`${lineRef}\`:`,
      '',
      '```',
      c.evidence_snippet,
      '```',
    ];
    return lines.join('\n');
  });
  return [
    `# ${name}`,
    '',
    'House conventions for this repo. Flag changes that violate any rule below and cite the offending `file:line`.',
    '',
    ...sections,
  ].join('\n');
}

function lineRefFor(c: Pick<ConventionCandidate, 'evidence_path' | 'evidence_line_start' | 'evidence_line_end'>): string {
  if (c.evidence_line_start == null) return c.evidence_path;
  if (c.evidence_line_end != null && c.evidence_line_end !== c.evidence_line_start) {
    return `${c.evidence_path}:${c.evidence_line_start}-${c.evidence_line_end}`;
  }
  return `${c.evidence_path}:${c.evidence_line_start}`;
}

// ---- evidence verification (model-derived candidates only) --------------

export interface LineRange {
  /** 1-indexed, inclusive. */
  start: number;
  end: number;
}

function normalizeLine(line: string): string {
  return line.replace(/[ \t]+$/, '');
}

/** Trim trailing whitespace per line, collapse blank-line runs, drop
 *  leading/trailing blank lines. Returns the normalized line array. */
export function normalizeSnippet(snippet: string): string[] {
  const lines = snippet.split('\n').map(normalizeLine);
  const collapsed: string[] = [];
  let prevBlank = false;
  for (const line of lines) {
    const isBlank = line.length === 0;
    if (isBlank && prevBlank) continue;
    collapsed.push(line);
    prevBlank = isBlank;
  }
  while (collapsed.length && collapsed[0] === '') collapsed.shift();
  while (collapsed.length && collapsed[collapsed.length - 1] === '') collapsed.pop();
  return collapsed;
}

function tokenize(line: string): string[] {
  return line.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}

/** Jaccard-ish similarity between two lines' token sets. 1 for identical lines. */
function lineSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  let hits = 0;
  for (const t of ta) if (setB.has(t)) hits++;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : hits / union;
}

/**
 * Search `fileContent` for `snippet`: exact contiguous line match first, then
 * a same-size sliding window scored by per-line token-overlap ratio (accepted
 * once the fraction of matched lines reaches `threshold`). Returns the 1-
 * indexed inclusive line range of the best match, or null if nothing clears
 * the bar — the caller discards the candidate in that case.
 */
export function findEvidenceLineRange(
  fileContent: string,
  snippet: string,
  threshold = EVIDENCE_FUZZY_THRESHOLD,
): LineRange | null {
  const fileLines = fileContent.split('\n').map(normalizeLine);
  const snippetLines = normalizeSnippet(snippet);
  if (snippetLines.length === 0 || fileLines.length < snippetLines.length) return null;

  // 1. Exact match.
  for (let i = 0; i <= fileLines.length - snippetLines.length; i++) {
    let ok = true;
    for (let j = 0; j < snippetLines.length; j++) {
      if (fileLines[i + j] !== snippetLines[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return { start: i + 1, end: i + snippetLines.length };
  }

  // 2. Fuzzy sliding window.
  let best: { start: number; score: number } | null = null;
  for (let i = 0; i <= fileLines.length - snippetLines.length; i++) {
    let matchedLines = 0;
    for (let j = 0; j < snippetLines.length; j++) {
      if (lineSimilarity(fileLines[i + j]!, snippetLines[j]!) >= threshold) matchedLines++;
    }
    const score = matchedLines / snippetLines.length;
    if (score >= threshold && (!best || score > best.score)) best = { start: i, score };
  }
  if (!best) return null;
  return { start: best.start + 1, end: best.start + snippetLines.length };
}

// ---- Decision 10: deterministic config-rule parsers ----------------------
// JSON configs via JSON.parse only. Flat JS/MJS configs via static regex/
// brace-matched text extraction — NEVER require()/import()/eval()'d, per this
// codebase's hard rule that config/archive content is read, never executed
// (docs/skills-feature-plan.md's Decision 4 precedent).

export interface ConfigCandidateDraft {
  rule: string;
  category: ConventionCategory;
  evidence_path: string;
  evidence_snippet: string;
  evidence_line_start: number;
  evidence_line_end: number;
  confidence: 1;
}

function findKeyLine(content: string, key: string): { line: number; text: string } | null {
  const lines = content.split('\n');
  const re = new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]!)) return { line: i + 1, text: lines[i]!.trim() };
  }
  return null;
}

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

/** Brace-matched substring of the first `{...}` following `needle` in
 *  `content` — a pure textual scan, never parsed as JS. */
function extractBracedBlockAfter(content: string, needle: string | RegExp): string | null {
  const idx = typeof needle === 'string' ? content.indexOf(needle) : content.search(needle);
  if (idx === -1) return null;
  const braceStart = content.indexOf('{', idx);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return content.slice(braceStart + 1, i);
    }
  }
  return null;
}

function buildEslintCandidate(
  ruleName: string,
  filePath: string,
  content: string,
): ConfigCandidateDraft {
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

/** Extract simple `key: literal` pairs (string/number/boolean only) from a
 *  textual object-literal body — pure regex, never evaluated as code. */
function parseSimpleKeyValueBlock(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const entryRe = /['"]?([\w$]+)['"]?\s*:\s*(true|false|\d+|'[^']*'|"[^"]*")/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(block))) {
    const key = m[1]!;
    const raw = m[2]!;
    if (raw === 'true') out[key] = true;
    else if (raw === 'false') out[key] = false;
    else if (/^\d+$/.test(raw)) out[key] = Number(raw);
    else out[key] = raw.slice(1, -1);
  }
  return out;
}

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

/** Route a config file's content through the right deterministic parser by
 *  filename. Unrecognized filenames yield no candidates. */
export function parseConfigFile(filePath: string, content: string): ConfigCandidateDraft[] {
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
