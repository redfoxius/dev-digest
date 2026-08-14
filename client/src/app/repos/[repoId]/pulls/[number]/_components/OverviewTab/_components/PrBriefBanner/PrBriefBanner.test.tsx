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
      />,
    );
    expect(screen.getByText(/6 findings · 1 blockers/)).toBeInTheDocument();
  });

  it("renders the empty-state copy, not VerdictBanner, when verdict is null", () => {
    renderWithIntl(<PrBriefBanner verdict={null} score={null} findings={null} costUsd={null} />);
    expect(
      screen.getByText("Run a review to see the PR Brief — verdict, score, and findings will appear here."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/findings ·/)).not.toBeInTheDocument();
  });

  it("renders the empty-state copy when verdict is undefined (no review has run yet)", () => {
    renderWithIntl(
      <PrBriefBanner verdict={undefined} score={undefined} findings={undefined} costUsd={undefined} />,
    );
    expect(
      screen.getByText("Run a review to see the PR Brief — verdict, score, and findings will appear here."),
    ).toBeInTheDocument();
  });
});
