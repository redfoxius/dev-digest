/* EvalDashboardDrilldown.test.tsx — per-agent Eval Dashboard drilldown (spec
   §6.10 AC-34, plan Work Item 13). Mocks `@/lib/hooks/agents`,
   `@/lib/hooks/evals` and `@/components/app-shell`, same shape as the list
   view's own test. Checkbox toggling is exercised via `fireEvent.click`,
   never `fireEvent.change` — `Checkbox` renders as a real `<button
   role="checkbox">`, not an `<input>` (client/INSIGHTS.md, 2026-08-06 entry). */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalDashboard, EvalTrendPoint } from "@devdigest/shared";
import messages from "../../../../../../messages/en/evalDashboard.json";

const { useAgentMock, useEvalDashboardMock, pushMock } = vi.hoisted(() => ({
  useAgentMock: vi.fn(),
  useEvalDashboardMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useParams: () => ({ agentId: "agent-42" }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgent: useAgentMock,
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalDashboard: useEvalDashboardMock,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// CompareRunsModal (Work Item 14) has its own dedicated test coverage
// (`_components/CompareRunsModal/CompareRunsModal.test.tsx`, AC-26/AC-27) —
// stubbed here so this file stays scoped to EvalDashboardDrilldown's own
// selection/open-state behavior without needing a QueryClientProvider (the
// real modal fetches agent versions via TanStack Query hooks not otherwise
// wired up in this test file).
vi.mock("./_components/CompareRunsModal", () => ({
  CompareRunsModal: () => <div data-testid="compare-modal">Compare modal</div>,
}));

import { EvalDashboardDrilldown } from "./EvalDashboardDrilldown";

afterEach(() => {
  cleanup();
  pushMock.mockClear();
  useAgentMock.mockReset();
  useEvalDashboardMock.mockReset();
});

function renderDrilldown() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evalDashboard: messages }}>
      <EvalDashboardDrilldown agentId="agent-42" />
    </NextIntlClientProvider>,
  );
}

function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-42",
    name: "Security Reviewer",
    description: "",
    provider: "openai",
    model: "gpt-5",
    system_prompt: "",
    output_schema: null,
    enabled: true,
    version: 3,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skills_count: 2,
    ...overrides,
  };
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

function dashboardFixture(overrides: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "agent-42",
    cases_total: 6,
    current: {
      recall: 0.82,
      precision: 0.91,
      citation_accuracy: 0.94,
      traces_passed: 5,
      traces_total: 6,
      cost_usd: 0.02,
    },
    delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
    trend: [
      trendPoint({ ran_at: "2026-08-01T00:00:00.000Z", recall: 0.7 }),
      trendPoint({ ran_at: "2026-08-05T00:00:00.000Z", recall: 0.82 }),
    ],
    recent_runs: [],
    alert: null,
    ...overrides,
  };
}

describe("EvalDashboardDrilldown (AC-34)", () => {
  it("renders the alert banner, metric cards, trend chart, and Recent Runs table from GET /agents/:id/eval-dashboard", () => {
    useAgentMock.mockReturnValue({ data: agentFixture(), isLoading: false });
    useEvalDashboardMock.mockReturnValue({
      data: dashboardFixture({ alert: "Precision dipped 2pts on v3 — recall and citation both up." }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderDrilldown();

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Precision dipped 2pts on v3");
    expect(screen.getByText("82%")).toBeInTheDocument(); // current recall
    expect(screen.getByText("Metric trend")).toBeInTheDocument();
    expect(screen.getByText("Recent runs")).toBeInTheDocument();
    // 2 trend points -> 2 data rows in the Recent Runs table
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("renders no alert banner when the dashboard's alert is null", () => {
    useAgentMock.mockReturnValue({ data: agentFixture(), isLoading: false });
    useEvalDashboardMock.mockReturnValue({
      data: dashboardFixture({ alert: null }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderDrilldown();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders an empty-history note and no table when trend is empty", () => {
    useAgentMock.mockReturnValue({ data: agentFixture(), isLoading: false });
    useEvalDashboardMock.mockReturnValue({
      data: dashboardFixture({ trend: [] }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderDrilldown();

    expect(screen.getByText(/No runs yet/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("row-selection: exactly 2 checkboxes can be selected, enabling Compare; a 3rd click is ignored", () => {
    useAgentMock.mockReturnValue({ data: agentFixture(), isLoading: false });
    useEvalDashboardMock.mockReturnValue({
      data: dashboardFixture({
        trend: [
          trendPoint({ ran_at: "2026-08-01T00:00:00.000Z" }),
          trendPoint({ ran_at: "2026-08-02T00:00:00.000Z" }),
          trendPoint({ ran_at: "2026-08-03T00:00:00.000Z" }),
        ],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderDrilldown();

    const compareButton = screen.getByRole("button", { name: "Compare" });
    expect(compareButton).toBeDisabled();

    const [cb0, cb1, cb2] = screen.getAllByRole("checkbox");
    expect(cb0).toBeDefined();
    expect(cb1).toBeDefined();
    expect(cb2).toBeDefined();

    fireEvent.click(cb0!);
    expect(cb0).toHaveAttribute("aria-checked", "true");
    expect(compareButton).toBeDisabled();

    fireEvent.click(cb1!);
    expect(cb1).toHaveAttribute("aria-checked", "true");
    expect(compareButton).not.toBeDisabled();

    // 3rd row's checkbox click is ignored — still unchecked, still only 2 selected
    fireEvent.click(cb2!);
    expect(cb2).toHaveAttribute("aria-checked", "false");
    expect(compareButton).not.toBeDisabled();

    // Clicking Compare opens the Compare-runs modal in place — no navigation.
    fireEvent.click(compareButton);
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("compare-modal")).toBeInTheDocument();

    // deselecting one drops back below the 2-row threshold
    fireEvent.click(cb0!);
    expect(cb0).toHaveAttribute("aria-checked", "false");
    expect(compareButton).toBeDisabled();
  });

  it("opens the Compare-runs modal only once exactly 2 rows are selected and Compare is clicked", () => {
    useAgentMock.mockReturnValue({ data: agentFixture(), isLoading: false });
    useEvalDashboardMock.mockReturnValue({
      data: dashboardFixture({
        trend: [
          trendPoint({ ran_at: "2026-08-01T00:00:00.000Z" }),
          trendPoint({ ran_at: "2026-08-02T00:00:00.000Z" }),
        ],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderDrilldown();

    expect(screen.queryByTestId("compare-modal")).not.toBeInTheDocument();

    const [cb0, cb1] = screen.getAllByRole("checkbox");
    fireEvent.click(cb0!);
    fireEvent.click(cb1!);
    expect(screen.queryByTestId("compare-modal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByTestId("compare-modal")).toBeInTheDocument();
  });

  it("loading state renders skeleton placeholders, not the metric/trend content", () => {
    useAgentMock.mockReturnValue({ data: undefined, isLoading: true });
    useEvalDashboardMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });

    renderDrilldown();

    expect(screen.queryByText("Metric trend")).not.toBeInTheDocument();
  });

  it("error state renders a retry affordance on a load failure", () => {
    const refetch = vi.fn();
    useAgentMock.mockReturnValue({ data: undefined, isLoading: false });
    useEvalDashboardMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    renderDrilldown();

    const retry = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalled();
  });
});
