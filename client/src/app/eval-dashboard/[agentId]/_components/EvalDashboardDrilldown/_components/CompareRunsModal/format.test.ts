import { describe, it, expect } from "vitest";
import type { EvalTrendPoint } from "@devdigest/shared";
import {
  computeDiffLines,
  formatRatio,
  hasPromptChanged,
  signedCostDelta,
  signedDelta,
  sortRunsByRanAtAsc,
} from "./format";

function trendPoint(overrides: Partial<EvalTrendPoint> = {}): EvalTrendPoint {
  return {
    ran_at: "2026-08-01T00:00:00.000Z",
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.95,
    pass_rate: 0.75,
    cost_usd: 0.01,
    ...overrides,
  };
}

describe("computeDiffLines / hasPromptChanged (AC-27)", () => {
  it("marks an added sentence as type 'add', leaves the rest 'same'", () => {
    // `before` ends with its OWN trailing newline so the shared first line
    // tokenizes identically in both strings (`diffLines` treats a line's
    // trailing "\n" as part of its token — a line lacking one because it's
    // at end-of-string is NOT the same token as that same text followed by
    // more content, which is why the unchanged line must already end in
    // "\n" here rather than only the appended sentence being on a new line).
    const before = "Review this diff for security bugs.\n";
    const after = "Review this diff for security bugs.\nAlso check for SQL injection.\n";

    const lines = computeDiffLines(before, after);

    expect(lines.some((l) => l.type === "add" && l.text === "Also check for SQL injection.")).toBe(true);
    expect(lines.some((l) => l.type === "same" && l.text === "Review this diff for security bugs.")).toBe(true);
    expect(hasPromptChanged(lines)).toBe(true);
  });

  it("reports no change for identical text", () => {
    const lines = computeDiffLines("same text", "same text");
    expect(hasPromptChanged(lines)).toBe(false);
  });
});

describe("sortRunsByRanAtAsc", () => {
  it("orders [earlier, later] regardless of input order", () => {
    const a = trendPoint({ ran_at: "2026-08-10T00:00:00.000Z" });
    const b = trendPoint({ ran_at: "2026-08-01T00:00:00.000Z" });

    expect(sortRunsByRanAtAsc([a, b])).toEqual([b, a]);
    expect(sortRunsByRanAtAsc([b, a])).toEqual([b, a]);
  });
});

describe("formatRatio / signedDelta / signedCostDelta (AC-26)", () => {
  it("formats a ratio to 2dp", () => {
    expect(formatRatio(0.8)).toBe("0.80");
  });

  it("formats a positive delta with an explicit '+' sign", () => {
    expect(signedDelta(0.04)).toBe("+0.04");
  });

  it("formats a negative delta with a '-' sign", () => {
    expect(signedDelta(-0.02)).toBe("-0.02");
  });

  it("formats a zero delta with no sign", () => {
    expect(signedDelta(0)).toBe("0.00");
  });

  it("formats signed cost deltas at 3dp with a '$' prefix", () => {
    expect(signedCostDelta(0.01)).toBe("+$0.010");
    expect(signedCostDelta(-0.005)).toBe("-$0.005");
    expect(signedCostDelta(0)).toBe("$0.000");
  });

  it("formats an unknown (null) cost delta as an em dash", () => {
    expect(signedCostDelta(null)).toBe("—");
  });
});
