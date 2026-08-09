import { parse as parseYaml } from 'yaml';
import type { ConventionCategory } from '@devdigest/shared';
import type { ConfigCandidateDraft, ConventionLangPack } from './types.js';

/**
 * Go convention pack — Phase 7.2 of docs/go-language-support-plan.md, the
 * first non-JS/TS convention pack. Probes `go.mod` (the `go` version
 * directive) and golangci-lint's YAML config (enabled linters), the closest
 * Go analogs of tsconfig's strictness flags and eslint's enforced rules.
 *
 * Two things this pack deliberately does NOT do, both resolved with the user
 * before writing this file rather than guessed:
 *  - No gofmt candidate. gofmt is Go's non-configurable, always-on
 *    formatting standard — there's no config file to point evidence at,
 *    which would break every other config-origin candidate's invariant
 *    that its evidence IS the config file it was parsed from. Out of scope
 *    for v1 (it's also arguably not a "house" convention at all, since
 *    every Go repo already gets it for free, not something this specific
 *    repo chose).
 *  - `.golangci.toml` is not probed. Only the YAML config shape
 *    (`.golangci.yml`/`.golangci.yaml`) is parsed — golangci-lint's TOML
 *    variant would need a second parser/dependency for a format that's
 *    rarer in practice; not built until a real need shows up.
 */

const CONFIG_FILE_CANDIDATES = ['go.mod', '.golangci.yml', '.golangci.yaml'] as const;

/** `go.mod`'s directive-line regex — read-only line scan, mirrors
 *  `GoDepGraph.buildEdges`'s existing `module <path>` reader
 *  (server/src/adapters/depgraph/go.ts) but for the `go <version>`
 *  directive instead (module path is an identifier, not a convention). */
const GO_DIRECTIVE_RE = /^go\s+(\d+\.\d+(?:\.\d+)?)\s*$/;

/** `go.mod`'s `go` directive → one `'type-safety'` candidate naming the
 *  assumed Go language version. No module-path candidate — a module path is
 *  an identifier, not a house convention a reviewer should enforce. */
export function parseGoModDirectives(content: string, filePath: string): ConfigCandidateDraft[] {
  const lines = content.split('\n');
  let lineIdx = -1;
  let version: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const m = GO_DIRECTIVE_RE.exec(lines[i]!.trim());
    if (m) {
      lineIdx = i;
      version = m[1];
      break;
    }
  }
  if (lineIdx === -1 || !version) return [];

  return [
    {
      rule: `This module targets Go ${version} (go.mod's \`go\` directive) — assume language features up to that version are available, and none newer.`,
      category: 'type-safety',
      evidence_path: filePath,
      evidence_snippet: lines[lineIdx]!.trim(),
      evidence_line_start: lineIdx + 1,
      evidence_line_end: lineIdx + 1,
      confidence: 1,
    },
  ];
}

/** golangci-lint linter name → convention category, mirroring
 *  `ESLINT_RULE_CATEGORY_MAP` (langs/typescript.ts). Unmapped enabled
 *  linters fall back to `'formatting'`, same "unmapped falls back" rule. */
const GOLANGCI_LINT_CATEGORY_MAP: Record<string, ConventionCategory> = {
  errcheck: 'error-handling',
  govet: 'error-handling',
  ineffassign: 'error-handling',
  staticcheck: 'error-handling',
  unused: 'error-handling',
  bodyclose: 'error-handling',
  sqlclosecheck: 'error-handling',
  noctx: 'error-handling',
  gosec: 'security',
  revive: 'naming',
  stylecheck: 'naming',
  depguard: 'imports',
  goimports: 'imports',
};

/** First `- <item>` list-entry line in `content` matching `item` exactly
 *  (quoted or bare), or null. YAML's list-item analog of `findKeyLine`. */
function findListItemLine(content: string, item: string): { line: number; text: string } | null {
  const lines = content.split('\n');
  const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*-\\s*['"]?${escaped}['"]?\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]!)) return { line: i + 1, text: lines[i]!.trim() };
  }
  return null;
}

/** golangci-lint's `linters.enable` list → one candidate per enabled
 *  linter, analogous to an ESLint rule enforced as `"error"`. Real YAML
 *  parse (the `yaml` package) — golangci-lint configs use real YAML
 *  features (nesting, anchors) a regex-only approach would likely
 *  mis-parse, unlike the flat JS object literals `parseSimpleKeyValueBlock`
 *  was built for. Never re-serialized/executed — parsed for reading only. */
export function parseGolangciLint(content: string, filePath: string): ConfigCandidateDraft[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    return [];
  }
  const linters = (parsed as { linters?: { enable?: unknown } } | null)?.linters;
  const enabled = linters?.enable;
  if (!Array.isArray(enabled)) return [];

  const out: ConfigCandidateDraft[] = [];
  for (const name of enabled) {
    if (typeof name !== 'string') continue;
    const category = GOLANGCI_LINT_CATEGORY_MAP[name] ?? 'formatting';
    const loc = findListItemLine(content, name);
    out.push({
      rule: `golangci-lint linter \`${name}\` is enabled — code must comply.`,
      category,
      evidence_path: filePath,
      evidence_snippet: loc?.text ?? name,
      evidence_line_start: loc?.line ?? 1,
      evidence_line_end: loc?.line ?? 1,
      confidence: 1,
    });
  }
  return out;
}

function matchesConfigFile(base: string): boolean {
  return base === 'go.mod' || base === '.golangci.yml' || base === '.golangci.yaml';
}

function parseConfigFile(filePath: string, content: string): ConfigCandidateDraft[] {
  const base = filePath.split('/').pop() ?? filePath;
  if (base === 'go.mod') return parseGoModDirectives(content, filePath);
  if (base === '.golangci.yml' || base === '.golangci.yaml') return parseGolangciLint(content, filePath);
  return [];
}

export const goPack: ConventionLangPack = {
  id: 'go',
  configFileCandidates: CONFIG_FILE_CANDIDATES,
  matchesConfigFile,
  parseConfigFile,
};
