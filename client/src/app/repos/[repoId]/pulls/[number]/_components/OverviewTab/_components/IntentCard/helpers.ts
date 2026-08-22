import type { Risk } from "@devdigest/shared";

/**
 * Merges `Intent.risks[]` with `RiskBrief.risks[]` into ONE de-duplicated
 * list for the Risk Areas section (AC-31). Matching is case-insensitive and
 * trimmed on `title`. Where both sources produced a risk with the same
 * normalized title, the `RiskBrief`-sourced version wins — it's generated
 * from a broader input signal (Intent + Blast + diff + issue + specs) than
 * `Intent`'s own narrower signal set — and the `Intent`-only duplicate is
 * dropped. When `briefRisks` is `undefined` (no Risk Brief generated yet for
 * this PR), `intentRisks` is returned completely unchanged.
 */
export function mergeRisks(intentRisks: Risk[], briefRisks: Risk[] | undefined): Risk[] {
  if (briefRisks === undefined) return intentRisks;

  const normalize = (title: string) => title.trim().toLowerCase();
  const briefByTitle = new Map(briefRisks.map((risk) => [normalize(risk.title), risk]));
  const matchedTitles = new Set<string>();

  const merged = intentRisks.map((intentRisk) => {
    const key = normalize(intentRisk.title);
    const briefMatch = briefByTitle.get(key);
    if (briefMatch) {
      matchedTitles.add(key);
      return briefMatch;
    }
    return intentRisk;
  });

  const briefOnly = briefRisks.filter((risk) => !matchedTitles.has(normalize(risk.title)));
  return [...merged, ...briefOnly];
}
