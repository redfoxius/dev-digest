import { describe, it, expect } from "vitest";
import type { EvalTrendPoint } from "@devdigest/shared";
import { formatRanAt, pct, sortRunsDescending, toggleRowSelection } from "./helpers";

function point(overrides: Partial<EvalTrendPoint> = {}): EvalTrendPoint {
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

describe("pct", () => {
  it("rounds a 0..1 ratio to a whole percent", () => {
    expect(pct(0.666)).toBe(67);
    expect(pct(1)).toBe(100);
    expect(pct(0)).toBe(0);
  });
});

describe("formatRanAt", () => {
  it("formats an ISO timestamp deterministically (UTC, minute precision)", () => {
    expect(formatRanAt("2026-08-01T14:32:07.000Z")).toBe("2026-08-01 14:32 UTC");
  });

  it("falls back to the raw string for an unparseable value", () => {
    expect(formatRanAt("not-a-date")).toBe("not-a-date");
  });
});

describe("sortRunsDescending", () => {
  it("orders trend points newest-first without mutating the input", () => {
    const trend = [
      point({ ran_at: "2026-08-01T00:00:00.000Z" }),
      point({ ran_at: "2026-08-03T00:00:00.000Z" }),
      point({ ran_at: "2026-08-02T00:00:00.000Z" }),
    ];
    const sorted = sortRunsDescending(trend);
    expect(sorted.map((p) => p.ran_at)).toEqual([
      "2026-08-03T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    ]);
    // original array (chronological, oldest-first — the shape the trend
    // chart itself relies on) is untouched
    expect(trend.map((p) => p.ran_at)).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
    ]);
  });
});

describe("toggleRowSelection (WI-13 — exactly 2 rows selectable at a time)", () => {
  it("selects an unselected row when fewer than 2 are already selected", () => {
    expect(toggleRowSelection(new Set(), 0)).toEqual(new Set([0]));
    expect(toggleRowSelection(new Set([0]), 1)).toEqual(new Set([0, 1]));
  });

  it("deselects an already-selected row regardless of cap", () => {
    expect(toggleRowSelection(new Set([0, 1]), 0)).toEqual(new Set([1]));
  });

  it("ignores a 3rd row's selection attempt once 2 are already selected", () => {
    const atCap = new Set([0, 1]);
    expect(toggleRowSelection(atCap, 2)).toEqual(new Set([0, 1]));
  });
});
