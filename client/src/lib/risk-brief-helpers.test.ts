import { describe, it, expect } from "vitest";
import type { Risk, ReviewFocusItem } from "@devdigest/shared";
import { buildFlaggedRefsMap } from "./risk-brief-helpers";

function makeRisk(overrides: Partial<Risk>): Risk {
  return {
    kind: "generic",
    title: "risk",
    explanation: "explanation",
    severity: "low",
    file_refs: [],
    ...overrides,
  };
}

function makeReviewFocusItem(overrides: Partial<ReviewFocusItem>): ReviewFocusItem {
  return {
    file: "src/example.ts",
    line: 1,
    reason: "reason",
    ...overrides,
  };
}

describe("buildFlaggedRefsMap", () => {
  it("resolves a file covered by two risks at different severities to the higher severity", () => {
    const risks: Risk[] = [
      makeRisk({ severity: "medium", file_refs: ["src/shared.ts"] }),
      makeRisk({ severity: "high", file_refs: ["src/shared.ts"] }),
    ];

    const map = buildFlaggedRefsMap(risks, []);

    expect(map.get("src/shared.ts")).toBe("high");
  });

  it("resolves the higher severity regardless of which risk is encountered first", () => {
    const risks: Risk[] = [
      makeRisk({ severity: "high", file_refs: ["src/shared.ts"] }),
      makeRisk({ severity: "medium", file_refs: ["src/shared.ts"] }),
    ];

    const map = buildFlaggedRefsMap(risks, []);

    expect(map.get("src/shared.ts")).toBe("high");
  });

  it("maps a reviewFocus-only file to the neutral 'flagged' sentinel", () => {
    const risks: Risk[] = [makeRisk({ severity: "high", file_refs: ["src/other.ts"] })];
    const reviewFocus: ReviewFocusItem[] = [makeReviewFocusItem({ file: "src/focus-only.ts" })];

    const map = buildFlaggedRefsMap(risks, reviewFocus);

    expect(map.get("src/focus-only.ts")).toBe("flagged");
  });

  it("does not let the neutral sentinel override a risk's real severity for the same file", () => {
    const risks: Risk[] = [makeRisk({ severity: "medium", file_refs: ["src/shared.ts"] })];
    const reviewFocus: ReviewFocusItem[] = [makeReviewFocusItem({ file: "src/shared.ts" })];

    const map = buildFlaggedRefsMap(risks, reviewFocus);

    expect(map.get("src/shared.ts")).toBe("medium");
  });

  it("leaves a file covered by neither risks nor reviewFocus absent from the map", () => {
    const risks: Risk[] = [makeRisk({ severity: "high", file_refs: ["src/risky.ts"] })];
    const reviewFocus: ReviewFocusItem[] = [makeReviewFocusItem({ file: "src/focused.ts" })];

    const map = buildFlaggedRefsMap(risks, reviewFocus);

    expect(map.has("src/untouched.ts")).toBe(false);
    expect(map.size).toBe(2);
  });

  it("returns an empty map for empty inputs", () => {
    const map = buildFlaggedRefsMap([], []);

    expect(map.size).toBe(0);
  });
});
