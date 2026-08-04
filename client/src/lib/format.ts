/**
 * Format a USD review cost. "—" = unknown (null/unpriced model or the run
 * never completed an LLM call), "Free" = a known-zero-cost model, "<$0.001"
 * = nonzero but too small to show at 3dp (avoids reading as free), else
 * "$X.XXX".
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd === 0) return "Free";
  if (usd < 0.001) return "<$0.001";
  return `$${usd.toFixed(3)}`;
}

/**
 * "$0.014 ($0.041)" — the most recent run's cost, with the PR's running
 * total in parens. Collapses to a single `formatCost(total)` when there's
 * nothing to contrast: no runs at all, only one run so far (latest === total),
 * or the latest run's own cost is unknown (the total is still the more
 * useful number to show alone in that case).
 */
export function formatCostPair(
  latest: number | null | undefined,
  total: number | null | undefined,
): string {
  if (total == null) return "—";
  if (latest == null || latest === total) return formatCost(total);
  return `${formatCost(latest)} (${formatCost(total)})`;
}
