import { describe, it, expect } from "vitest";
import type { AgentVersion } from "@devdigest/shared";
import { resolveAgentVersionForBatch } from "./helpers";

function versionFixture(overrides: Partial<AgentVersion> = {}): AgentVersion {
  return {
    agent_id: "agent-42",
    version: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    config: {
      provider: "openai",
      model: "gpt-5",
      system_prompt: "Review this diff.",
      output_schema: null,
      strategy: "single-pass",
      ci_fail_on: "critical",
      repo_intel: true,
      skills: [],
    },
    ...overrides,
  };
}

describe("resolveAgentVersionForBatch (AC-22)", () => {
  it("resolves a batch whose ran_at falls between two versions to the EARLIER version", () => {
    // v1 at T0, v2 at T1 > T0 — exact spec Verify-line scenario.
    const v1 = versionFixture({ version: 1, created_at: "2026-08-01T00:00:00.000Z" });
    const v2 = versionFixture({ version: 2, created_at: "2026-08-10T00:00:00.000Z" });

    const resolved = resolveAgentVersionForBatch([v1, v2], "2026-08-05T00:00:00.000Z");

    expect(resolved).toBe(v1);
  });

  it("resolves a batch ran after the newest version to the LATER version", () => {
    const v1 = versionFixture({ version: 1, created_at: "2026-08-01T00:00:00.000Z" });
    const v2 = versionFixture({ version: 2, created_at: "2026-08-10T00:00:00.000Z" });

    const resolved = resolveAgentVersionForBatch([v1, v2], "2026-08-15T00:00:00.000Z");

    expect(resolved).toBe(v2);
  });

  it("is independent of input ordering (unsorted version list resolves the same)", () => {
    const v1 = versionFixture({ version: 1, created_at: "2026-08-01T00:00:00.000Z" });
    const v2 = versionFixture({ version: 2, created_at: "2026-08-10T00:00:00.000Z" });
    const v3 = versionFixture({ version: 3, created_at: "2026-08-20T00:00:00.000Z" });

    const resolved = resolveAgentVersionForBatch([v3, v1, v2], "2026-08-12T00:00:00.000Z");

    expect(resolved).toBe(v2);
  });

  it("treats an exact ran_at === created_at match as that version being live (<=, not <)", () => {
    const v1 = versionFixture({ version: 1, created_at: "2026-08-01T00:00:00.000Z" });

    const resolved = resolveAgentVersionForBatch([v1], "2026-08-01T00:00:00.000Z");

    expect(resolved).toBe(v1);
  });

  it("returns undefined when ran_at predates every known version", () => {
    const v1 = versionFixture({ version: 1, created_at: "2026-08-10T00:00:00.000Z" });

    const resolved = resolveAgentVersionForBatch([v1], "2026-08-01T00:00:00.000Z");

    expect(resolved).toBeUndefined();
  });

  it("returns undefined for an empty version list", () => {
    expect(resolveAgentVersionForBatch([], "2026-08-01T00:00:00.000Z")).toBeUndefined();
  });
});
