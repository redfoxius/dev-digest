import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor (docs/onboarding-generator-plan.md Work Item 11, AC-26/AC-27)", () => {
  it("AC-27 — the top-level add-a-repo route no longer false-positives onto the onboarding-tour nav item", () => {
    expect(activeKeyFor("/onboarding")).toBe("");
  });

  it("AC-27 — the real onboarding-tour page route highlights the onboarding-tour nav item", () => {
    expect(activeKeyFor("/repos/abc/tour")).toBe("onboarding-tour");
  });

  it("does not regress other existing sidebar routes", () => {
    expect(activeKeyFor("/repos/abc/context")).toBe("context");
    expect(activeKeyFor("/repos/abc/conventions")).toBe("conventions");
    expect(activeKeyFor("/repos/abc/pulls")).toBe("pulls");
    expect(activeKeyFor("/settings/api-keys")).toBe("settings");
  });
});
