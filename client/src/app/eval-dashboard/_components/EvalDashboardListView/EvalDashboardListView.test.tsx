/* EvalDashboardListView.test.tsx — Eval Dashboard list page (spec §6.10
   AC-33/AC-34, plan Work Item 13). Mocks `@/lib/hooks/agents` and
   `@/lib/hooks/evals` (data layer) and `@/components/app-shell`
   (routing/command-palette chrome, irrelevant here), per
   `onboarding/page.test.tsx`'s established mocking shape. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalDashboard } from "@devdigest/shared";
import messages from "../../../../../messages/en/evalDashboard.json";

const { useAgentsMock, useEvalDashboardMock, pushMock } = vi.hoisted(() => ({
  useAgentsMock: vi.fn(),
  useEvalDashboardMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: useAgentsMock,
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalDashboard: useEvalDashboardMock,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { EvalDashboardListView } from "./EvalDashboardListView";

afterEach(() => {
  cleanup();
  pushMock.mockClear();
  useAgentsMock.mockReset();
  useEvalDashboardMock.mockReset();
});

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evalDashboard: messages }}>
      <EvalDashboardListView />
    </NextIntlClientProvider>,
  );
}

function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Security Reviewer",
    description: "",
    provider: "openai",
    model: "gpt-5",
    system_prompt: "",
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skills_count: 0,
    ...overrides,
  };
}

function dashboardFixture(overrides: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "agent-1",
    cases_total: 5,
    current: {
      recall: 0.8,
      precision: 0.9,
      citation_accuracy: 0.95,
      traces_passed: 4,
      traces_total: 5,
      cost_usd: 0.01,
    },
    delta: { recall: 0.02, precision: -0.01, citation_accuracy: 0 },
    trend: [],
    recent_runs: [],
    alert: null,
    ...overrides,
  };
}

describe("EvalDashboardListView (AC-33)", () => {
  it("composes GET /agents with one GET /agents/:id/eval-dashboard call PER agent, rendering exactly N summary rows", () => {
    const agents = [
      agentFixture({ id: "a1", name: "Security Reviewer" }),
      agentFixture({ id: "a2", name: "Style Checker" }),
      agentFixture({ id: "a3", name: "Perf Reviewer" }),
    ];
    useAgentsMock.mockReturnValue({ data: agents, isLoading: false, isError: false, refetch: vi.fn() });
    useEvalDashboardMock.mockImplementation((agentId: string) => ({
      data: dashboardFixture({ owner_id: agentId }),
      isLoading: false,
      isError: false,
    }));

    renderPage();

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Style Checker")).toBeInTheDocument();
    expect(screen.getByText("Perf Reviewer")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Open .*'s eval dashboard/ })).toHaveLength(3);
    // Each row's own useEvalDashboard call used ITS agent id — confirms N
    // independent per-agent calls, not one shared/bulk fetch.
    expect(useEvalDashboardMock).toHaveBeenCalledWith("a1");
    expect(useEvalDashboardMock).toHaveBeenCalledWith("a2");
    expect(useEvalDashboardMock).toHaveBeenCalledWith("a3");
  });

  it("AC-34 — clicking one agent's row navigates to its drilldown route", () => {
    useAgentsMock.mockReturnValue({
      data: [agentFixture({ id: "agent-42", name: "Security Reviewer" })],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useEvalDashboardMock.mockReturnValue({ data: dashboardFixture(), isLoading: false, isError: false });

    renderPage();

    screen.getByRole("button", { name: /Open Security Reviewer's eval dashboard/ }).click();
    expect(pushMock).toHaveBeenCalledWith("/eval-dashboard/agent-42");
  });

  it("loading state renders skeleton placeholders, not the row list", () => {
    useAgentsMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    useEvalDashboardMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    renderPage();

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("empty state renders when there are zero agents", () => {
    useAgentsMock.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    useEvalDashboardMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderPage();

    expect(screen.getByText("No agents yet")).toBeInTheDocument();
  });

  it("error state renders a retry affordance on a load failure", () => {
    const refetch = vi.fn();
    useAgentsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    useEvalDashboardMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderPage();

    const retry = screen.getByRole("button", { name: /retry/i });
    retry.click();
    expect(refetch).toHaveBeenCalled();
  });
});
