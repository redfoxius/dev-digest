/* helpers.test.ts — pure-function coverage for the Onboarding Tour route's
   `relativeTime`/`regenerateErrorMessage` (spec §6.5 AC-21/AC-23). Neither
   had a direct unit test before this audit pass — both were only exercised
   indirectly through `page.test.tsx`'s mocked-data renders, which never
   independently confirmed the actual TRANSFORMATION each function performs
   (a raw ISO timestamp -> "just now"/"Nm ago"/etc.; an ApiError -> one of
   three distinct, spec-mandated messages), only that whatever string came
   back rendered somewhere on the page. */
import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import { relativeTime, regenerateErrorMessage } from "./helpers";

describe("relativeTime (AC-21 — subtitle interpolates generated_at)", () => {
  it("formats null/undefined/unparseable input as 'never'", () => {
    expect(relativeTime(null)).toBe("never");
    expect(relativeTime(undefined)).toBe("never");
    expect(relativeTime("not-a-date")).toBe("never");
  });

  it("formats a timestamp from moments ago as 'just now'", () => {
    const now = new Date().toISOString();
    expect(relativeTime(now)).toBe("just now");
  });

  it("formats a timestamp from a few minutes ago as 'Nm ago'", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("formats a timestamp from a few hours ago as 'Nh ago'", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    expect(relativeTime(threeHoursAgo)).toBe("3h ago");
  });
});

describe("regenerateErrorMessage (AC-9/AC-23 — a Regenerate failure states plainly what happened)", () => {
  const t = {
    notIndexed: "This repo hasn't been indexed yet — index it before generating a tour.",
    failedWithPrevious: "Generation failed — your previous tour is still shown below.",
    failedNoPrevious: "Generation failed. Try again.",
  };

  it("a 422 not_indexed error always returns the honest never-indexed message, regardless of whether a tour previously existed", () => {
    const err = new ApiError("index this repo first", 422, "not_indexed");
    expect(regenerateErrorMessage(err, true, t)).toBe(t.notIndexed);
    expect(regenerateErrorMessage(err, false, t)).toBe(t.notIndexed);
  });

  it("a generic (502) failure with a previously-persisted tour reassures the previous content is still shown, distinct from the no-tour-yet case (AC-9)", () => {
    const err = new ApiError("provider unreachable", 502, "external_service_error");
    const withPrevious = regenerateErrorMessage(err, true, t);
    const withoutPrevious = regenerateErrorMessage(err, false, t);

    expect(withPrevious).toContain(t.failedWithPrevious);
    expect(withoutPrevious).toContain(t.failedNoPrevious);
    expect(withPrevious).not.toBe(withoutPrevious);
    // The underlying server error detail is preserved, not swallowed.
    expect(withPrevious).toContain("provider unreachable");
  });
});
