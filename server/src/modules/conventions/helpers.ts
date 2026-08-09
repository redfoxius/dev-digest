import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionStatus,
  ConventionOrigin,
} from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';
import { EVIDENCE_FUZZY_THRESHOLD } from './constants.js';

/**
 * Pure helpers for the conventions module — DB row ⇄ DTO mapping and the
 * code-only, language-agnostic evidence-verification algorithm. No I/O
 * (service.ts owns the clone reads/LLM call) so everything here is
 * unit-testable without a DB or a model. Decision 10's deterministic
 * config-rule parsers moved to `./langs/` (per-language convention packs,
 * Phase 7.1 of docs/go-language-support-plan.md) — see
 * docs/conventions-extractor-plan.md for the original design.
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
    language: row.language ?? null,
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

