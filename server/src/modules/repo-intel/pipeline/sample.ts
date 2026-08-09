/**
 * repo-intel pipeline — language-stratified file sampling (Phase 7.3,
 * docs/go-language-support-plan.md).
 *
 * Pure + deterministic given (rankedPaths, languages, n, languageOf): no DB,
 * no clock. Mirrors `rank.ts`'s split of the pure PageRank computation out
 * of its DB-reading service wrapper, for the same reason — hermetically
 * unit-testable without a repository stub or Postgres.
 */

/**
 * Reserve an even split of `n` slots across `languages` from `rankedPaths`
 * (already rank-DESC sorted and junk-path-filtered by the caller), then fill
 * any leftover slots with global top-rank fill. Closes the gap where a
 * structurally more central language's files crowd a less-central one
 * entirely out of a mixed-language repo's sample — plain top-N has no
 * per-language quota.
 */
export function stratifyByLanguage(
  rankedPaths: readonly string[],
  languages: readonly string[],
  n: number,
  languageOf: (path: string) => string | null,
): string[] {
  if (n <= 0) return [];
  if (languages.length === 0) return rankedPaths.slice(0, n);

  const perLanguage = Math.max(1, Math.floor(n / languages.length));
  const out: string[] = [];
  const seen = new Set<string>();

  for (const lang of languages) {
    let count = 0;
    for (const path of rankedPaths) {
      if (count >= perLanguage) break;
      if (seen.has(path)) continue;
      if (languageOf(path) !== lang) continue;
      seen.add(path);
      out.push(path);
      count++;
    }
  }

  if (out.length < n) {
    for (const path of rankedPaths) {
      if (out.length >= n) break;
      if (seen.has(path)) continue;
      seen.add(path);
      out.push(path);
    }
  }

  return out.slice(0, n);
}
