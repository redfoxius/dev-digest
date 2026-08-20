/* nav.test.ts — AC-26 (Onboarding Generator, spec §6.6): "The system shall
   add a new 'Onboarding Tour' sidebar item to the WORKSPACE nav group
   (`NAV`), alongside 'Pull Requests'/'Project Context', routed at
   `/repos/:repoId/tour`." No test asserted on `NAV`'s actual data before
   this audit pass — `activeKeyFor`'s own tests (`app-shell/helpers.test.ts`)
   only cover routing/highlighting, never that the nav entry itself exists
   with the right group/href. */
import { describe, it, expect } from "vitest";
import { NAV } from "./nav";

describe("NAV (AC-26 — Onboarding Tour sidebar item)", () => {
  it("the WORKSPACE group contains an 'Onboarding Tour' item routed at /repos/:repoId/tour, alongside Pull Requests and Project Context", () => {
    const workspaceGroup = NAV.find((g) => g.section === "WORKSPACE");
    expect(workspaceGroup).toBeDefined();

    const onboardingItem = workspaceGroup!.items.find((i) => i.key === "onboarding-tour");
    expect(onboardingItem).toMatchObject({
      label: "Onboarding Tour",
      href: "/repos/:repoId/tour",
    });

    const keys = workspaceGroup!.items.map((i) => i.key);
    expect(keys).toContain("pulls");
    expect(keys).toContain("context");
    expect(keys).toContain("onboarding-tour");
  });
});
