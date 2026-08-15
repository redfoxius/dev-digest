import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

// jsdom has no real layout engine — scrollIntoView isn't implemented.
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

// Both hooks live in the same module — ReviewRunAccordion uses
// useDeleteReview, FindingsPanel (nested inside it) uses useFindingAction.
// Mocking here (same relative depth as FindingsPanel.test.tsx/
// ReviewRunAccordion.test.tsx) intercepts the same resolved module those
// components import via their own relative paths.
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsTab } from "./FindingsTab";

afterEach(cleanup);

const REVIEW: ReviewRecord = {
  id: "rev-1",
  pr_id: "pr-1",
  agent_id: "a1",
  run_id: "run-1",
  agent_name: "Security Reviewer",
  kind: "review",
  verdict: "comment",
  summary: "Looks fine.",
  score: 82,
  model: "gpt-4.1",
  grounding: "2/2 passed",
  cost_usd: 0.014,
  created_at: "2026-06-11T18:44:34.000Z",
  findings: [
    {
      id: "f1",
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key",
      file: "src/config.ts",
      start_line: 11,
      end_line: 11,
      rationale: "A live Stripe key is committed in source.",
      suggestion: null,
      confidence: 0.95,
      kind: "finding",
      trifecta_components: null,
      evidence: null,
      review_id: "rev-1",
      accepted_at: null,
      dismissed_at: null,
    },
  ],
};

const REVIEW_2: ReviewRecord = {
  ...REVIEW,
  id: "rev-2",
  run_id: "run-2",
  agent_name: "Performance Reviewer",
  findings: [
    {
      id: "f2",
      severity: "WARNING",
      category: "perf",
      title: "N+1 query in loop",
      file: "src/loop.ts",
      start_line: 20,
      end_line: 20,
      rationale: "Queries inside a loop.",
      suggestion: null,
      confidence: 0.8,
      kind: "finding",
      trifecta_components: null,
      evidence: null,
      review_id: "rev-2",
      accepted_at: null,
      dismissed_at: null,
    },
  ],
};

function renderTab(
  onViewInDiff?: (file: string, line: number) => void,
  runs: ReviewRecord[] = [REVIEW],
  scrollTarget?: { runId: string; findingId: string; nonce: number } | null,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsTab
        prId="pr-1"
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        runs={runs}
        prRuns={undefined}
        prCommits={[]}
        cancelMutation={{ mutate: vi.fn(), isPending: false } as any}
        onOpenTrace={vi.fn()}
        onDelete={vi.fn()}
        onRunDone={vi.fn()}
        onViewInDiff={onViewInDiff}
        scrollTarget={scrollTarget}
      />
    </NextIntlClientProvider>,
  );
}

describe("FindingsTab — view-in-diff round trip (Phase 4)", () => {
  it("clicking a finding's view-in-diff icon fires onViewInDiff(file, start_line)", () => {
    const onViewInDiff = vi.fn();
    renderTab(onViewInDiff);

    // The first run's accordion defaults open (defaultOpen={i === 0} in
    // FindingsTab), so the finding + its icon are already in the DOM.
    fireEvent.click(screen.getByLabelText("View in diff"));

    expect(onViewInDiff).toHaveBeenCalledWith("src/config.ts", 11);
  });

  it("the icon is absent everywhere when onViewInDiff is omitted", () => {
    renderTab(undefined);
    expect(screen.queryByLabelText("View in diff")).not.toBeInTheDocument();
  });
});

describe("FindingsTab — external scrollTarget from the Diff tab (severity badge → FindingCard)", () => {
  it("the second run's accordion starts collapsed with no external target", () => {
    renderTab(undefined, [REVIEW, REVIEW_2]);
    expect(screen.queryByText("N+1 query in loop")).not.toBeInTheDocument();
  });

  it("an external scrollTarget for the second run's finding opens that accordion and scrolls to it", () => {
    renderTab(undefined, [REVIEW, REVIEW_2], { runId: "run-2", findingId: "f2", nonce: 1 });

    expect(screen.getByText("N+1 query in loop")).toBeInTheDocument();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
