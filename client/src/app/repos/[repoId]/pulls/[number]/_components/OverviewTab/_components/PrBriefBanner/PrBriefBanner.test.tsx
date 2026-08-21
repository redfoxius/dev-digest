import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import prReviewMessages from "../../../../../../../../../../messages/en/prReview.json";
import { PrBriefBanner } from "./PrBriefBanner";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PrBriefBanner", () => {
  it("renders VerdictBanner with the correct verdict/score/cost when a verdict is present", () => {
    renderWithIntl(
      <PrBriefBanner
        verdict="request_changes"
        score={65}
        findings={{ critical: 1, warning: 2, suggestion: 3 }}
        costUsd={0.003}
        riskLevel={null}
      />,
    );
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("65")).toBeInTheDocument();
    expect(screen.getByText("$0.003")).toBeInTheDocument();
  });

  it("derives findingsCount (sum) and blockers (critical only) from the findings breakdown", () => {
    renderWithIntl(
      <PrBriefBanner
        verdict="request_changes"
        score={65}
        findings={{ critical: 1, warning: 2, suggestion: 3 }}
        costUsd={null}
        riskLevel={null}
      />,
    );
    expect(screen.getByText(/6 findings · 1 blockers/)).toBeInTheDocument();
  });

  it("renders the empty-state copy, not VerdictBanner, when verdict is null", () => {
    renderWithIntl(
      <PrBriefBanner verdict={null} score={null} findings={null} costUsd={null} riskLevel={null} />,
    );
    expect(
      screen.getByText("Run a review to see the PR Brief — verdict, score, and findings will appear here."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/findings ·/)).not.toBeInTheDocument();
  });

  it("renders the empty-state copy when verdict is undefined (no review has run yet)", () => {
    renderWithIntl(
      <PrBriefBanner
        verdict={undefined}
        score={undefined}
        findings={undefined}
        costUsd={undefined}
        riskLevel={undefined}
      />,
    );
    expect(
      screen.getByText("Run a review to see the PR Brief — verdict, score, and findings will appear here."),
    ).toBeInTheDocument();
  });

  it("renders the risk badge inside the empty-state branch when riskLevel is set but verdict is null", () => {
    renderWithIntl(
      <PrBriefBanner verdict={null} score={null} findings={null} costUsd={null} riskLevel="high" />,
    );
    expect(
      screen.getByText("Run a review to see the PR Brief — verdict, score, and findings will appear here."),
    ).toBeInTheDocument();
    expect(screen.getByText("High risk")).toBeInTheDocument();
  });

  it("renders the risk badge alongside VerdictBanner when both riskLevel and verdict are set", () => {
    renderWithIntl(
      <PrBriefBanner
        verdict="request_changes"
        score={65}
        findings={{ critical: 1, warning: 2, suggestion: 3 }}
        costUsd={0.003}
        riskLevel="high"
      />,
    );
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("High risk")).toBeInTheDocument();
  });

  it("renders no risk badge in either branch when riskLevel is null or undefined", () => {
    const { unmount } = renderWithIntl(
      <PrBriefBanner verdict={null} score={null} findings={null} costUsd={null} riskLevel={null} />,
    );
    expect(screen.queryByText(/risk$/)).not.toBeInTheDocument();
    unmount();

    renderWithIntl(
      <PrBriefBanner
        verdict="request_changes"
        score={65}
        findings={{ critical: 1, warning: 2, suggestion: 3 }}
        costUsd={0.003}
        riskLevel={undefined}
      />,
    );
    expect(screen.queryByText(/risk$/)).not.toBeInTheDocument();
  });
});
