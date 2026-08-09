import { describe, it, expect } from 'vitest';
import {
  normalizeSnippet,
  findEvidenceLineRange,
  slugifyRule,
  buildSkillBody,
  toConventionDto,
} from '../src/modules/conventions/helpers.js';
import { parseConfigFile } from '../src/modules/conventions/langs/index.js';
import {
  parseTsconfigStrictness,
  parseEslintRules,
  parsePrettierConfig,
} from '../src/modules/conventions/langs/typescript.js';
import { parseGoModDirectives, parseGolangciLint } from '../src/modules/conventions/langs/go.js';
import { dedupKey } from '../src/modules/conventions/repository.js';
import type { ConventionCandidate } from '@devdigest/shared';
import type { ConventionRow } from '../src/db/rows.js';

/**
 * Unit coverage for the conventions module's pure helpers — no DB, no LLM.
 * DB-backed extract()/list()/createSkillFromCandidates() coverage lives in
 * `conventions.it.test.ts` (real Postgres via testcontainers).
 */

describe('normalizeSnippet', () => {
  it('trims trailing whitespace per line', () => {
    expect(normalizeSnippet('const x = 1;   \nconst y = 2;\t')).toEqual([
      'const x = 1;',
      'const y = 2;',
    ]);
  });

  it('collapses runs of blank lines', () => {
    expect(normalizeSnippet('a\n\n\n\nb')).toEqual(['a', '', 'b']);
  });

  it('drops leading/trailing blank lines', () => {
    expect(normalizeSnippet('\n\na\nb\n\n')).toEqual(['a', 'b']);
  });
});

describe('findEvidenceLineRange', () => {
  const file = [
    'import { db } from "./db";',
    '',
    'export async function getUser(id: string) {',
    '  const user = await db.users.find(id);',
    '  return user;',
    '}',
  ].join('\n');

  it('finds an exact contiguous match and returns 1-indexed line range', () => {
    const range = findEvidenceLineRange(file, '  const user = await db.users.find(id);\n  return user;');
    expect(range).toEqual({ start: 4, end: 5 });
  });

  it('finds a fuzzy match when whitespace/casing-adjacent but token-similar', () => {
    // Same tokens, slightly different literal text (extra spacing) — should
    // still clear the 0.9 threshold via token-overlap, not exact match.
    const range = findEvidenceLineRange(file, 'const  user  =  await  db.users.find(id);');
    expect(range).not.toBeNull();
    expect(range!.start).toBe(4);
  });

  it('returns null (discard) when the snippet does not appear in the file at all', () => {
    const range = findEvidenceLineRange(file, 'export const totallyUnrelatedThing = 42;');
    expect(range).toBeNull();
  });

  it('returns null for an empty/whitespace-only snippet', () => {
    expect(findEvidenceLineRange(file, '   \n  \n')).toBeNull();
  });
});

describe('slugifyRule', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyRule('Always use async/await instead of .then() chains')).toBe(
      'always-use-async-await-instead-of-then-chains',
    );
  });

  it('caps length and trims trailing hyphens', () => {
    const long = 'a'.repeat(100) + ' rule';
    expect(slugifyRule(long).length).toBeLessThanOrEqual(60);
    expect(slugifyRule(long).endsWith('-')).toBe(false);
  });
});

describe('buildSkillBody', () => {
  it('emits one ## section per candidate with the rule, snippet, and file:line', () => {
    const candidates: ConventionCandidate[] = [
      {
        id: '1',
        rule: 'Always use async/await',
        category: 'error-handling',
        evidence_path: 'src/api/users.ts',
        evidence_snippet: 'const x = await f();',
        evidence_line_start: 23,
        evidence_line_end: 31,
        confidence: 0.9,
        status: 'accepted',
        origin: 'model',
      },
    ];
    const body = buildSkillBody('payments-api-conventions', candidates);
    expect(body).toContain('# payments-api-conventions');
    expect(body).toContain('## always-use-async-await');
    expect(body).toContain('Always use async/await');
    expect(body).toContain('Detected in `src/api/users.ts:23-31`');
    expect(body).toContain('const x = await f();');
  });
});

describe('toConventionDto', () => {
  it('maps a DB row to the public candidate shape', () => {
    const row = {
      id: 'c1',
      workspaceId: 'w1',
      repoId: 'r1',
      rule: 'Rule text',
      category: 'naming',
      evidencePath: 'a.ts',
      evidenceSnippet: 'code',
      evidenceLineStart: 1,
      evidenceLineEnd: 2,
      confidence: 0.5,
      status: 'pending',
      origin: 'model',
    } as unknown as ConventionRow;
    expect(toConventionDto(row)).toEqual({
      id: 'c1',
      rule: 'Rule text',
      category: 'naming',
      evidence_path: 'a.ts',
      evidence_snippet: 'code',
      evidence_line_start: 1,
      evidence_line_end: 2,
      confidence: 0.5,
      status: 'pending',
      origin: 'model',
    });
  });
});

describe('dedupKey', () => {
  it('is case- and whitespace-insensitive so near-identical re-scans dedup', () => {
    expect(dedupKey('  Always use async/await  ', 'src/api/users.ts')).toBe(
      dedupKey('always use async/await', 'SRC/API/USERS.TS'),
    );
  });
});

describe('parseTsconfigStrictness', () => {
  it('emits one type-safety candidate per enforced strictness flag present and true', () => {
    const content = JSON.stringify(
      { compilerOptions: { strict: true, noImplicitAny: true, target: 'ES2022' } },
      null,
      2,
    );
    const out = parseTsconfigStrictness(content, 'tsconfig.json');
    expect(out.map((c) => c.rule).join(' ')).toMatch(/strict mode/i);
    expect(out.every((c) => c.category === 'type-safety' && c.confidence === 1)).toBe(true);
    expect(out.length).toBe(2);
    // Line numbers must point at the actual key in the file.
    for (const c of out) {
      expect(c.evidence_line_start).toBeGreaterThan(0);
    }
  });

  it('returns [] for invalid JSON without throwing', () => {
    expect(parseTsconfigStrictness('{ not valid json', 'tsconfig.json')).toEqual([]);
  });

  it('returns [] when no strictness flags are set to true', () => {
    const content = JSON.stringify({ compilerOptions: { target: 'ES2022' } });
    expect(parseTsconfigStrictness(content, 'tsconfig.json')).toEqual([]);
  });
});

describe('parseEslintRules', () => {
  it('parses a JSON .eslintrc and only surfaces rules enforced as error/2', () => {
    const content = JSON.stringify({
      rules: {
        'no-console': 'error',
        'no-debugger': 'warn',
        'import/order': 2,
        'no-alert': 0,
      },
    });
    const out = parseEslintRules(content, '.eslintrc.json');
    const ruleNames = out.map((c) => c.rule).join(' ');
    expect(ruleNames).toContain('no-console');
    expect(ruleNames).toContain('import/order');
    expect(ruleNames).not.toContain('no-debugger');
    expect(ruleNames).not.toContain('no-alert');
  });

  it('parses a flat eslint.config.js without ever evaluating it', () => {
    let sideEffectRan = false;
    // A deliberately side-effecting statement a naive `require()`/`eval()`
    // implementation WOULD execute — this must never run.
    const content = `
      globalThis.__CONVENTIONS_TEST_SIDE_EFFECT__ = true;
      export default [
        {
          rules: {
            'no-console': 'error',
            '@typescript-eslint/no-explicit-any': 'error',
            'no-debugger': 'warn',
          },
        },
      ];
    `;
    const out = parseEslintRules(content, 'eslint.config.js');
    sideEffectRan = (globalThis as Record<string, unknown>).__CONVENTIONS_TEST_SIDE_EFFECT__ === true;
    expect(sideEffectRan).toBe(false);
    const ruleNames = out.map((c) => c.rule).join(' ');
    expect(ruleNames).toContain('no-console');
    expect(ruleNames).toContain('@typescript-eslint/no-explicit-any');
    expect(ruleNames).not.toContain('no-debugger');
    // type-safety category mapping for a known rule name.
    expect(out.find((c) => c.rule.includes('no-explicit-any'))?.category).toBe('type-safety');
  });

  it('returns [] when there is no rules block at all', () => {
    expect(parseEslintRules('export default [];', 'eslint.config.js')).toEqual([]);
  });
});

describe('parsePrettierConfig', () => {
  it('parses JSON .prettierrc, only for keys actually present', () => {
    const content = JSON.stringify({ semi: false, singleQuote: true });
    const out = parsePrettierConfig(content, '.prettierrc');
    expect(out.length).toBe(2);
    expect(out.every((c) => c.category === 'formatting')).toBe(true);
    expect(out.map((c) => c.rule).join(' ')).toContain('semi');
    expect(out.map((c) => c.rule).join(' ')).not.toContain('printWidth');
  });

  it('parses a flat prettier.config.js without evaluating it', () => {
    const content = `module.exports = {\n  semi: false,\n  printWidth: 100,\n};\n`;
    const out = parsePrettierConfig(content, 'prettier.config.js');
    const rules = out.map((c) => c.rule).join(' ');
    expect(rules).toContain('semi');
    expect(rules).toContain('printWidth');
  });

  it('returns [] for an unrecognized/empty config', () => {
    expect(parsePrettierConfig('not json and no export', 'prettier.config.js')).toEqual([]);
  });
});

describe('parseConfigFile (dispatch by filename)', () => {
  it('routes tsconfig.json to the tsconfig parser', () => {
    const content = JSON.stringify({ compilerOptions: { strict: true } });
    const out = parseConfigFile('tsconfig.json', content);
    expect(out[0]?.category).toBe('type-safety');
  });

  it('routes go.mod to the Go directive parser', () => {
    const out = parseConfigFile('go.mod', 'module example.com/greeter\n\ngo 1.22\n');
    expect(out[0]?.category).toBe('type-safety');
    expect(out[0]?.rule).toContain('1.22');
  });

  it('routes .golangci.yml to the golangci-lint parser', () => {
    const out = parseConfigFile('.golangci.yml', 'linters:\n  enable:\n    - errcheck\n');
    expect(out[0]?.category).toBe('error-handling');
  });

  it('returns [] for an unrecognized filename', () => {
    expect(parseConfigFile('README.md', '# hi')).toEqual([]);
  });
});

describe('parseGoModDirectives', () => {
  it('emits one type-safety candidate for the go directive, with the right line number', () => {
    const content = 'module example.com/greeter\n\ngo 1.22\n\nrequire (\n\tfoo v1.0.0\n)\n';
    const out = parseGoModDirectives(content, 'go.mod');
    expect(out.length).toBe(1);
    expect(out[0]!.category).toBe('type-safety');
    expect(out[0]!.confidence).toBe(1);
    expect(out[0]!.rule).toContain('Go 1.22');
    expect(out[0]!.evidence_line_start).toBe(3);
    expect(out[0]!.evidence_snippet).toBe('go 1.22');
  });

  it('returns [] when go.mod has no go directive', () => {
    expect(parseGoModDirectives('module example.com/greeter\n', 'go.mod')).toEqual([]);
  });

  it('returns [] for empty content without throwing', () => {
    expect(parseGoModDirectives('', 'go.mod')).toEqual([]);
  });
});

describe('parseGolangciLint', () => {
  it('emits one candidate per enabled linter, mapped to its category', () => {
    const content = ['linters:', '  enable:', '    - errcheck', '    - gosec', '    - revive'].join('\n');
    const out = parseGolangciLint(content, '.golangci.yml');
    const byName = new Map(out.map((c) => [c.rule, c]));
    expect(out.length).toBe(3);
    expect([...byName.values()].find((c) => c.rule.includes('errcheck'))?.category).toBe('error-handling');
    expect([...byName.values()].find((c) => c.rule.includes('gosec'))?.category).toBe('security');
    expect([...byName.values()].find((c) => c.rule.includes('revive'))?.category).toBe('naming');
    // Line numbers point at the actual list entry, not always line 1.
    for (const c of out) expect(c.evidence_line_start).toBeGreaterThan(0);
  });

  it('falls back to formatting for an unmapped linter name', () => {
    const content = 'linters:\n  enable:\n    - whitespace\n';
    const out = parseGolangciLint(content, '.golangci.yml');
    expect(out[0]?.category).toBe('formatting');
  });

  it('returns [] when there is no linters.enable list', () => {
    expect(parseGolangciLint('linters:\n  disable-all: true\n', '.golangci.yml')).toEqual([]);
    expect(parseGolangciLint('run:\n  timeout: 5m\n', '.golangci.yml')).toEqual([]);
  });

  it('returns [] for invalid YAML without throwing', () => {
    expect(parseGolangciLint(':\n  - not: [valid\n', '.golangci.yml')).toEqual([]);
  });
});
