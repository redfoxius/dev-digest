import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";

// `IntentCard` is mocked entirely (not its underlying data-fetching hooks) so
// this test only exercises OverviewTab's own composition/prop-threading, per
// docs/intent-smartdiff-improvements.md Phase 2's test plan. `PrBriefBanner`
// is likewise mocked so its received props can be asserted directly, without
// re-testing PrBriefBanner's own rendering logic (covered by
// PrBriefBanner.test.tsx).
vi.mock("./_components/IntentCard", () => ({
  IntentCard: ({ prId }: { prId: string | null | undefined }) => (
    <div data-testid="intent-card">{prId}</div>
  ),
}));

const prBriefBannerMock = vi.fn();
vi.mock("./_components/PrBriefBanner", () => ({
  PrBriefBanner: (props: unknown) => {
    prBriefBannerMock(props);
    return <div data-testid="pr-brief-banner" />;
  },
}));

// BlastRadiusCard fetches via usePrBlastRadius (React Query) — mocked out for
// the same reason IntentCard is: this test only exercises OverviewTab's own
// composition/prop-threading, not the card's own data-fetching logic.
vi.mock("./_components/BlastRadiusCard", () => ({
  BlastRadiusCard: ({ prId }: { prId: string | null | undefined }) => (
    <div data-testid="blast-radius-card">{prId}</div>
  ),
}));

// RiskBriefCard self-fetches via usePrRiskBrief (React Query) — mocked for
// the same reason as the other three cards, but its mock exposes a clickable
// row so this file's own AC-20 test can assert the exact `onViewInDiff` prop
// OverviewTab threads through as `onJumpToDiff` (RiskBriefCard.test.tsx
// covers the real review-focus-row click behavior; this only checks
// OverviewTab wires the right callback into the right prop).
vi.mock("./_components/RiskBriefCard", () => ({
  RiskBriefCard: ({
    prId,
    onViewInDiff,
  }: {
    prId: string | null | undefined;
    onViewInDiff: (file: string, line: number) => void;
  }) => (
    <div data-testid="risk-brief-card">
      {prId}
      <button onClick={() => onViewInDiff("src/config.ts", 12)}>review-focus-row</button>
    </div>
  ),
}));

import { OverviewTab } from "./OverviewTab";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const FINDINGS = { critical: 1, warning: 2, suggestion: 3 };

describe("OverviewTab", () => {
  it("renders PrBriefBanner above IntentCard, above Description", () => {
    const { container } = renderWithIntl(
      <OverviewTab
        prBody="Some PR description."
        prId="pr-1"
        verdict="request_changes"
        score={65}
        findings={FINDINGS}
        latestRunCostUsd={0.003}
        onOpenBlast={() => {}}
        onViewInDiff={() => {}}
        prFilePaths={new Set()}
        onJumpToDiff={() => {}}
      />,
    );
    const order = Array.from(container.querySelectorAll("[data-testid], section")).map((el) =>
      el.getAttribute("data-testid") ?? el.tagName,
    );
    expect(order.indexOf("pr-brief-banner")).toBeLessThan(order.indexOf("intent-card"));
    expect(order.indexOf("intent-card")).toBeLessThan(order.indexOf("SECTION"));
    expect(screen.getByText("Some PR description.")).toBeInTheDocument();
  });

  it("threads verdict/score/findings/latestRunCostUsd into PrBriefBanner unchanged", () => {
    renderWithIntl(
      <OverviewTab
        prBody={null}
        prId="pr-1"
        verdict="approve"
        score={100}
        findings={FINDINGS}
        latestRunCostUsd={0.01}
        onOpenBlast={() => {}}
        onViewInDiff={() => {}}
        prFilePaths={new Set()}
        onJumpToDiff={() => {}}
      />,
    );
    expect(prBriefBannerMock).toHaveBeenCalledWith({
      verdict: "approve",
      score: 100,
      findings: FINDINGS,
      costUsd: 0.01,
    });
  });

  it("threads prId into IntentCard", () => {
    renderWithIntl(
      <OverviewTab
        prBody={null}
        prId="pr-42"
        verdict={null}
        score={null}
        findings={null}
        latestRunCostUsd={null}
        onOpenBlast={() => {}}
        onViewInDiff={() => {}}
        prFilePaths={new Set()}
        onJumpToDiff={() => {}}
      />,
    );
    expect(screen.getByTestId("intent-card")).toHaveTextContent("pr-42");
  });

  it("does not render a Description section when prBody is falsy", () => {
    renderWithIntl(
      <OverviewTab
        prBody={null}
        prId="pr-1"
        verdict={null}
        score={null}
        findings={null}
        latestRunCostUsd={null}
        onOpenBlast={() => {}}
        onViewInDiff={() => {}}
        prFilePaths={new Set()}
        onJumpToDiff={() => {}}
      />,
    );
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });

  // AC-17: all four Overview cards render additively — PrBriefBanner,
  // IntentCard, BlastRadiusCard, and the new Risk Brief card.
  it("renders all four card sections (PrBriefBanner, IntentCard, BlastRadiusCard, RiskBriefCard)", () => {
    renderWithIntl(
      <OverviewTab
        prBody={null}
        prId="pr-1"
        verdict={null}
        score={null}
        findings={null}
        latestRunCostUsd={null}
        onOpenBlast={() => {}}
        onViewInDiff={() => {}}
        prFilePaths={new Set()}
        onJumpToDiff={() => {}}
      />,
    );
    expect(screen.getByTestId("pr-brief-banner")).toBeInTheDocument();
    expect(screen.getByTestId("intent-card")).toBeInTheDocument();
    expect(screen.getByTestId("blast-radius-card")).toBeInTheDocument();
    expect(screen.getByTestId("risk-brief-card")).toBeInTheDocument();
  });

  // AC-20: a Review Focus row click must call the distinct `onJumpToDiff`
  // callback (bound to page.tsx's raw, always-in-app `handleViewInDiff`) —
  // never the existing `onViewInDiff` prop (bound to `handleCallerClick`,
  // which has a GitHub-fallback branch), with the exact {file, line}.
  it("threads onJumpToDiff into RiskBriefCard's onViewInDiff prop, called with the exact {file, line}", () => {
    const onJumpToDiff = vi.fn();
    const onViewInDiff = vi.fn();
    renderWithIntl(
      <OverviewTab
        prBody={null}
        prId="pr-1"
        verdict={null}
        score={null}
        findings={null}
        latestRunCostUsd={null}
        onOpenBlast={() => {}}
        onViewInDiff={onViewInDiff}
        prFilePaths={new Set()}
        onJumpToDiff={onJumpToDiff}
      />,
    );

    fireEvent.click(screen.getByText("review-focus-row"));

    expect(onJumpToDiff).toHaveBeenCalledWith("src/config.ts", 12);
    expect(onViewInDiff).not.toHaveBeenCalled();
  });
});
