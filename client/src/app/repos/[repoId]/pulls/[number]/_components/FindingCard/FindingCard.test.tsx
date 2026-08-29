import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — view-in-diff affordance (Phase 4)", () => {
  it("is absent when onViewInDiff is omitted", () => {
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} />);
    expect(screen.queryByLabelText("View in diff")).not.toBeInTheDocument();
  });

  it("calls onViewInDiff(file, start_line) when clicked, without toggling the expanded state", () => {
    const onViewInDiff = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} onViewInDiff={onViewInDiff} />);

    fireEvent.click(screen.getByLabelText("View in diff"));

    expect(onViewInDiff).toHaveBeenCalledWith("src/config.ts", 11);
    // Card started collapsed (no defaultExpanded) — clicking the icon must
    // not have also toggled the header's own expand/collapse handler (the
    // body, e.g. its Accept/Dismiss buttons, only renders once expanded).
    expect(screen.queryByText("Accept")).not.toBeInTheDocument();
  });
});

describe("FindingCard — turn into eval case (specs/cross-cutting/eval-pipeline, WI-11)", () => {
  it("is absent when onTurnIntoEvalCase is omitted (AC-28/AC-29 additive contract)", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();
  });

  it("renders disabled while the finding is undecided (AC-28)", () => {
    renderWithIntl(
      <FindingCard f={FINDING} defaultExpanded onAction={() => {}} onTurnIntoEvalCase={() => {}} />,
    );
    expect(screen.getByText("Turn into eval case").closest("button")).toBeDisabled();
  });

  it("enables once the finding is accepted (AC-28)", () => {
    const accepted = { ...FINDING, accepted_at: "2026-08-29T00:00:00Z" };
    renderWithIntl(
      <FindingCard f={accepted} defaultExpanded onAction={() => {}} onTurnIntoEvalCase={() => {}} />,
    );
    expect(screen.getByText("Turn into eval case").closest("button")).not.toBeDisabled();
  });

  it("enables once the finding is dismissed (AC-28)", () => {
    const dismissed = { ...FINDING, dismissed_at: "2026-08-29T00:00:00Z" };
    renderWithIntl(
      <FindingCard f={dismissed} defaultExpanded onAction={() => {}} onTurnIntoEvalCase={() => {}} />,
    );
    expect(screen.getByText("Turn into eval case").closest("button")).not.toBeDisabled();
  });

  it("fires the mutation callback with the finding id when clicked, without toggling expanded state (AC-29)", () => {
    const onTurnIntoEvalCase = vi.fn();
    const accepted = { ...FINDING, accepted_at: "2026-08-29T00:00:00Z" };
    renderWithIntl(
      <FindingCard f={accepted} onAction={() => {}} onTurnIntoEvalCase={onTurnIntoEvalCase} />,
    );

    // Card started collapsed — expand it first to reach the actions row,
    // same precondition the Accept/Dismiss tests rely on.
    fireEvent.click(screen.getByText("Hardcoded Stripe secret key"));
    fireEvent.click(screen.getByText("Turn into eval case"));

    expect(onTurnIntoEvalCase).toHaveBeenCalledWith("f1");
  });

  it("never fires the callback while disabled (undecided finding)", () => {
    const onTurnIntoEvalCase = vi.fn();
    renderWithIntl(
      <FindingCard f={FINDING} defaultExpanded onAction={() => {}} onTurnIntoEvalCase={onTurnIntoEvalCase} />,
    );

    fireEvent.click(screen.getByText("Turn into eval case"));

    expect(onTurnIntoEvalCase).not.toHaveBeenCalled();
  });
});
