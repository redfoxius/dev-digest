/**
 * Language-agnostic text-scanning primitives shared by every convention
 * pack's config parser — none of these reference a TS/JS-specific shape.
 * Mirrors `astgrep/shared.ts`'s split of generic tree helpers out of the
 * TS/JS-only file they used to live in (Phase 1 of
 * docs/go-language-support-plan.md); here the equivalent split is out of
 * `conventions/helpers.ts`, which had the same "one language's parser file"
 * problem for config-rule extraction. Never `require()`/`import()`/`eval()`s
 * config content — pure text/regex scanning only, per this repo's
 * archive/config-content rule (docs/skills-feature-plan.md's Decision 4).
 */

/** First line in `content` whose trimmed text contains a `"key":`/`'key':`
 *  pattern, or null if the key never appears. Used to anchor a config-derived
 *  candidate's evidence to a real line instead of always pointing at line 1. */
export function findKeyLine(content: string, key: string): { line: number; text: string } | null {
  const lines = content.split('\n');
  const re = new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]!)) return { line: i + 1, text: lines[i]!.trim() };
  }
  return null;
}

/** Brace-matched substring of the first `{...}` following `needle` in
 *  `content` — a pure textual scan, never parsed/evaluated as code. */
export function extractBracedBlockAfter(content: string, needle: string | RegExp): string | null {
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

/** Extract simple `key: literal` pairs (string/number/boolean only) from a
 *  textual object-literal body — pure regex, never evaluated as code. */
export function parseSimpleKeyValueBlock(block: string): Record<string, unknown> {
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
