import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCase, EvalDashboard } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";
import { ToastProvider } from "@/lib/toast";

// Mocks are read inside the vi.mock factories below (hoisted above these
// imports), so the spies themselves must be created via vi.hoisted — same
// pattern as SkillsTab.test.tsx/ContextTab.test.tsx.
const {
  runSetMutate,
  runCaseMutate,
  deleteCaseMutate,
  useEvalDashboardMock,
  useEvalCasesMock,
  refetchDashMock,
  refetchCasesMock,
} = vi.hoisted(() => ({
  runSetMutate: vi.fn(),
  runCaseMutate: vi.fn(),
  deleteCaseMutate: vi.fn(),
  refetchDashMock: vi.fn(),
  refetchCasesMock: vi.fn(),
  useEvalDashboardMock: vi.fn(),
  useEvalCasesMock: vi.fn(),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalDashboard: useEvalDashboardMock,
  useEvalCases: useEvalCasesMock,
  useRunEvalSet: () => ({ mutate: runSetMutate, isPending: false }),
  useRunEvalCase: () => ({ mutate: runCaseMutate, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: deleteCaseMutate, isPending: false }),
  useCreateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  runSetMutate.mockClear();
  runCaseMutate.mockClear();
  deleteCaseMutate.mockClear();
  refetchDashMock.mockClear();
  refetchCasesMock.mockClear();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  skills_count: 0,
};

const DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 2,
  current: { recall: 0.75, precision: 0.9, citation_accuracy: 0.95, traces_passed: 3, traces_total: 4, cost_usd: 0.02 },
  delta: { recall: 0.05, precision: -0.02, citation_accuracy: 0.01 },
  trend: [],
  recent_runs: [
    {
      id: "run-c1",
      case_id: "c1",
      case_name: "Hardcoded secret",
      ran_at: "2026-08-20T10:00:00Z",
      actual_output: { findings: [{ file: "a.ts" }], must_find_matched: 1, must_find_total: 1, noise_count: 0, kept: 1, dropped: 0 },
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      duration_ms: 1200,
      cost_usd: 0.001,
    },
    {
      id: "run-c2",
      case_id: "c2",
      case_name: "Retry-After false positive",
      ran_at: "2026-08-20T10:00:00Z",
      actual_output: { findings: [{ file: "b.ts" }, { file: "c.ts" }], must_find_matched: 0, must_find_total: 0, noise_count: 2, kept: 2, dropped: 0 },
      pass: false,
      recall: 1,
      precision: 0,
      citation_accuracy: 1,
      duration_ms: 900,
      cost_usd: 0.0008,
    },
  ],
  alert: "Precision dipped 2pts on v3 — recall and citation both up.",
};

// c1: must_find case with a passing last run (1 expected, 1 got).
// c2: must_not_flag case with a failing last run (0 expected must_find, 2 got).
// c3: never run.
const CASES: EvalCase[] = [
  {
    id: "c1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "Hardcoded secret",
    input_diff: "diff --git a/a.ts b/a.ts",
    input_files: null,
    input_meta: null,
    expected_output: { expectations: [{ type: "must_find", file: "a.ts", start_line: 1, end_line: 1, description: "secret" }] },
    notes: null,
  },
  {
    id: "c2",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "Retry-After false positive",
    input_diff: "diff --git a/b.ts b/b.ts",
    input_files: null,
    input_meta: null,
    expected_output: { expectations: [{ type: "must_not_flag", file: "b.ts", start_line: 5, end_line: 5, description: null }] },
    notes: null,
  },
  {
    id: "c3",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "Never run case",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: { expectations: [] },
    notes: null,
  },
];

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>
        <EvalsTab agent={AGENT} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab", () => {
  useEvalDashboardMock.mockImplementation(() => ({
    data: DASHBOARD,
    isLoading: false,
    isError: false,
    refetch: refetchDashMock,
  }));
  useEvalCasesMock.mockImplementation(() => ({
    data: CASES,
    isLoading: false,
    isError: false,
    refetch: refetchCasesMock,
  }));

  it("renders the dashboard summary cards from GET /agents/:id/eval-dashboard (AC-30)", () => {
    renderTab();
    expect(screen.getByText("75")).toBeInTheDocument(); // recall %
    expect(screen.getByText("90")).toBeInTheDocument(); // precision %
    expect(screen.getByText("95")).toBeInTheDocument(); // citation accuracy %
    expect(screen.getByText("3/4")).toBeInTheDocument(); // traces passed of total
  });

  it("renders one row per case with the correct pass/fail/never-run icon from that case's own latest run (AC-30)", () => {
    renderTab();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Retry-After false positive")).toBeInTheDocument();
    expect(screen.getByText("Never run case")).toBeInTheDocument();

    // c1 passed its last run.
    expect(screen.getByTitle("Passed on its last run")).toBeInTheDocument();
    // c2 failed its last run.
    expect(screen.getByTitle("Failed on its last run")).toBeInTheDocument();
    // c3 was never run.
    expect(screen.getByTitle("Never run")).toBeInTheDocument();
  });

  it("shows each case's 'expected N / got M' counts, which may validly disagree (AC-30/AC-19)", () => {
    renderTab();
    // c1: 1 must_find expectation, last run found 1.
    expect(screen.getByText("expected 1 / got 1")).toBeInTheDocument();
    // c2: 0 must_find expectations (a must_not_flag-only case), last run found 2 (noise).
    expect(screen.getByText("expected 0 / got 2")).toBeInTheDocument();
    // c3: 0 expectations, never run -> no "got" count.
    expect(screen.getByText("expected 0 / got —")).toBeInTheDocument();
  });

  it("renders the dashboard's alert banner when present", () => {
    renderTab();
    expect(screen.getByText(/Precision dipped 2pts on v3/)).toBeInTheDocument();
  });

  it("clicking 'Run all evals' calls useRunEvalSet's mutate (AC-31)", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    expect(runSetMutate).toHaveBeenCalledTimes(1);
  });

  it("clicking a case row's Run action calls useRunEvalCase's mutate with that case's id", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: 'Run "Hardcoded secret"' }));
    expect(runCaseMutate).toHaveBeenCalledWith("c1", expect.objectContaining({ onSuccess: expect.any(Function), onSettled: expect.any(Function) }));
  });

  it("clicking a case row's Delete action opens a confirm dialog, and confirming calls useDeleteEvalCase's mutate", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: 'Delete "Hardcoded secret"' }));
    expect(screen.getByText("Delete eval case")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteCaseMutate).toHaveBeenCalledWith("c1", expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it("clicking a case row's Edit action opens the case editor modal pre-filled with that case's name", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: 'Edit "Hardcoded secret"' }));
    expect(screen.getByText("Edit eval case")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hardcoded secret")).toBeInTheDocument();
  });

  it("clicking 'New case' opens the create modal with an empty name field", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "New case" }));
    expect(screen.getByText("New eval case")).toBeInTheDocument();
  });

  it("shows an empty state instead of the list when the agent has zero eval cases", () => {
    useEvalCasesMock.mockReturnValueOnce({ data: [], isLoading: false, isError: false, refetch: refetchCasesMock });
    renderTab();
    expect(screen.getByText(/No eval cases yet/)).toBeInTheDocument();
  });

  it("shows an error state with retry when either query fails", () => {
    useEvalDashboardMock.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchDashMock,
    });
    renderTab();
    expect(screen.getByText("Couldn't load evals for this agent.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetchDashMock).toHaveBeenCalled();
  });
});
