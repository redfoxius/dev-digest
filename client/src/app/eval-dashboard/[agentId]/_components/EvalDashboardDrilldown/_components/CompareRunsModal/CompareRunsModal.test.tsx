/* CompareRunsModal.test.tsx — Compare-runs view (spec §6.7 AC-26/AC-27, plan
   Work Item 14). Mocks `@/lib/hooks/agents` (`useAgentVersions`/
   `useAgentVersion`), same shape as `EvalDashboardDrilldown.test.tsx`'s own
   `useAgent` mock. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentVersion, EvalTrendPoint } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/evalDashboard.json";

const { useAgentVersionsMock, useAgentVersionMock } = vi.hoisted(() => ({
  useAgentVersionsMock: vi.fn(),
  useAgentVersionMock: vi.fn(),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgentVersions: useAgentVersionsMock,
  useAgentVersion: useAgentVersionMock,
}));

import { CompareRunsModal } from "./CompareRunsModal";

afterEach(() => {
  cleanup();
  useAgentVersionsMock.mockReset();
  useAgentVersionMock.mockReset();
});

function renderModal(runs: [EvalTrendPoint, EvalTrendPoint]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evalDashboard: messages }}>
      <CompareRunsModal agentId="agent-42" runs={runs} onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

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

function versionFixture(overrides: Partial<AgentVersion> = {}): AgentVersion {
  return {
    agent_id: "agent-42",
    version: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    config: {
      provider: "openai",
      model: "gpt-5",
      system_prompt: "Review this diff for security bugs.",
      output_schema: null,
      strategy: "single-pass",
      ci_fail_on: "critical",
      repo_intel: true,
      skills: [],
    },
    ...overrides,
  };
}

describe("CompareRunsModal (AC-26)", () => {
  it("renders both versions' recall/precision/citation/cost and each metric's signed delta", () => {
    const earlier = trendPoint({
      ran_at: "2026-08-05T00:00:00.000Z",
      recall: 0.78,
      precision: 0.93,
      citation_accuracy: 0.94,
      cost_usd: 0.01,
    });
    const later = trendPoint({
      ran_at: "2026-08-15T00:00:00.000Z",
      recall: 0.82,
      precision: 0.91,
      citation_accuracy: 0.95,
      cost_usd: 0.02,
    });
    const v1 = versionFixture({ version: 1, created_at: "2026-08-01T00:00:00.000Z" });
    const v2 = versionFixture({
      version: 2,
      created_at: "2026-08-10T00:00:00.000Z",
      config: { ...v1.config, system_prompt: "Review this diff for security bugs. Also check for SQL injection." },
    });

    useAgentVersionsMock.mockReturnValue({ data: [v1, v2], isLoading: false, isError: false, refetch: vi.fn() });
    useAgentVersionMock.mockImplementation((_agentId: string, version: number | null | undefined) => {
      if (version === 1) return { data: v1, isLoading: false, isError: false };
      if (version === 2) return { data: v2, isLoading: false, isError: false };
      return { data: undefined, isLoading: false, isError: false };
    });

    // Selected in reverse-chronological order — the component sorts by ran_at.
    renderModal([later, earlier]);

    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();

    expect(screen.getByText("0.78")).toBeInTheDocument();
    expect(screen.getByText("0.82")).toBeInTheDocument();
    expect(screen.getByText("+0.04")).toBeInTheDocument(); // recall delta

    expect(screen.getByText("0.93")).toBeInTheDocument();
    expect(screen.getByText("0.91")).toBeInTheDocument();
    expect(screen.getByText("-0.02")).toBeInTheDocument(); // precision delta

    expect(screen.getByText("0.94")).toBeInTheDocument();
    expect(screen.getByText("0.95")).toBeInTheDocument();
    expect(screen.getByText("+0.01")).toBeInTheDocument(); // citation delta

    expect(screen.getByText("$0.010")).toBeInTheDocument();
    expect(screen.getByText("$0.020")).toBeInTheDocument();
    expect(screen.getByText("+$0.010")).toBeInTheDocument(); // cost delta
  });

  it("renders an inline message instead of crashing when a run's version cannot be resolved", () => {
    const earlier = trendPoint({ ran_at: "2026-07-01T00:00:00.000Z" }); // predates the only known version
    const later = trendPoint({ ran_at: "2026-08-15T00:00:00.000Z" });
    const v1 = versionFixture({ version: 1, created_at: "2026-08-01T00:00:00.000Z" });

    useAgentVersionsMock.mockReturnValue({ data: [v1], isLoading: false, isError: false, refetch: vi.fn() });
    useAgentVersionMock.mockImplementation((_agentId: string, version: number | null | undefined) => {
      if (version === 1) return { data: v1, isLoading: false, isError: false };
      return { data: undefined, isLoading: false, isError: false };
    });

    renderModal([later, earlier]);

    expect(screen.getByText(/No agent version existed yet/)).toBeInTheDocument();
    expect(screen.getByText(/System prompt diff unavailable/)).toBeInTheDocument();
  });
});

describe("CompareRunsModal (AC-27)", () => {
  it("renders an added sentence in the system-prompt diff as structurally/visually marked-added, not just present as plain text", () => {
    const earlier = trendPoint({ ran_at: "2026-08-05T00:00:00.000Z" });
    const later = trendPoint({ ran_at: "2026-08-15T00:00:00.000Z" });
    // v1's system prompt ends with its OWN trailing newline so its shared
    // first line tokenizes identically to `diffLines` in both versions —
    // see `format.test.ts`'s comment for why the unchanged line must
    // already end in "\n" rather than only the appended sentence being on
    // a new line.
    const v1 = versionFixture({
      version: 1,
      created_at: "2026-08-01T00:00:00.000Z",
      config: {
        provider: "openai",
        model: "gpt-5",
        system_prompt: "Review this diff for security bugs.\n",
        output_schema: null,
        strategy: "single-pass",
        ci_fail_on: "critical",
        repo_intel: true,
        skills: [],
      },
    });
    const v2 = versionFixture({
      version: 2,
      created_at: "2026-08-10T00:00:00.000Z",
      config: { ...v1.config, system_prompt: `${v1.config.system_prompt}Also check for SQL injection.\n` },
    });

    useAgentVersionsMock.mockReturnValue({ data: [v1, v2], isLoading: false, isError: false, refetch: vi.fn() });
    useAgentVersionMock.mockImplementation((_agentId: string, version: number | null | undefined) => {
      if (version === 1) return { data: v1, isLoading: false, isError: false };
      if (version === 2) return { data: v2, isLoading: false, isError: false };
      return { data: undefined, isLoading: false, isError: false };
    });

    renderModal([earlier, later]);

    const addedLine = screen.getByText(/Also check for SQL injection\./);
    const addedWrapper = addedLine.closest('[data-diff-type="add"]');
    expect(addedWrapper).not.toBeNull();

    // The unchanged sentence must NOT be marked as added.
    const unchangedLine = screen.getByText(/Review this diff for security bugs\./);
    expect(unchangedLine.closest('[data-diff-type="add"]')).toBeNull();
    expect(unchangedLine.closest('[data-diff-type="same"]')).not.toBeNull();
  });

  it("renders a 'no difference' note when both resolved versions share the same system prompt", () => {
    const earlier = trendPoint({ ran_at: "2026-08-05T00:00:00.000Z" });
    const later = trendPoint({ ran_at: "2026-08-15T00:00:00.000Z" });
    const v1 = versionFixture({ version: 1, created_at: "2026-08-01T00:00:00.000Z" });
    const v2 = versionFixture({ version: 2, created_at: "2026-08-10T00:00:00.000Z" });

    useAgentVersionsMock.mockReturnValue({ data: [v1, v2], isLoading: false, isError: false, refetch: vi.fn() });
    useAgentVersionMock.mockImplementation((_agentId: string, version: number | null | undefined) => {
      if (version === 1) return { data: v1, isLoading: false, isError: false };
      if (version === 2) return { data: v2, isLoading: false, isError: false };
      return { data: undefined, isLoading: false, isError: false };
    });

    renderModal([earlier, later]);

    expect(screen.getByText(/system prompts are identical/)).toBeInTheDocument();
  });
});
