import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

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

function renderTab(onViewInDiff?: (file: string, line: number) => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsTab
        prId="pr-1"
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        runs={[REVIEW]}
        prRuns={undefined}
        prCommits={[]}
        cancelMutation={{ mutate: vi.fn(), isPending: false } as any}
        onOpenTrace={vi.fn()}
        onDelete={vi.fn()}
        onRunDone={vi.fn()}
        onViewInDiff={onViewInDiff}
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
