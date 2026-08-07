import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionCandidateCard } from "./ConventionCandidateCard";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  rule: "Always use async/await instead of .then() chains",
  category: "error-handling",
  evidence_path: "src/api/users.ts",
  evidence_snippet: "const user = await db.users.find(id);",
  evidence_line_start: 23,
  evidence_line_end: 31,
  confidence: 0.91,
  status: "accepted",
  origin: "model",
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ConventionCandidateCard", () => {
  it("renders the rule, category, and evidence snippet", () => {
    renderWithIntl(<ConventionCandidateCard c={CANDIDATE} />);
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText("error-handling")).toBeInTheDocument();
    expect(screen.getByText(CANDIDATE.evidence_snippet)).toBeInTheDocument();
    expect(screen.getByText("AI-detected")).toBeInTheDocument();
  });

  it("shows a 'From config' badge for config-derived candidates", () => {
    renderWithIntl(<ConventionCandidateCard c={{ ...CANDIDATE, origin: "config", confidence: 1 }} />);
    expect(screen.getByText("From config")).toBeInTheDocument();
  });

  // Hard acceptance criterion: evidence must click through to the real
  // GitHub blob at the right line range, via the same githubBlobUrl() helper
  // FindingCard already uses.
  it("builds a clickable GitHub blob link pinned to the evidence file:line", () => {
    renderWithIntl(
      <ConventionCandidateCard c={CANDIDATE} repoFullName="acme/payments-api" sha="abc123" />,
    );
    const link = screen.getByText(/src\/api\/users\.ts/).closest("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123/src/api/users.ts#L23-L31",
    );
  });

  it("renders no link (plain text) when repoFullName/sha are unavailable", () => {
    renderWithIntl(<ConventionCandidateCard c={CANDIDATE} />);
    const link = screen.getByText(/src\/api\/users\.ts/).closest("a");
    expect(link).toBeNull();
  });

  it("fires accept/reject and rule-edit callbacks", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onRuleChange = vi.fn();
    renderWithIntl(
      <ConventionCandidateCard
        c={{ ...CANDIDATE, status: "pending" }}
        onAccept={onAccept}
        onReject={onReject}
        onRuleChange={onRuleChange}
      />,
    );
    fireEvent.click(screen.getByText("Accepted"));
    expect(onAccept).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Reject"));
    expect(onReject).toHaveBeenCalled();

    fireEvent.click(screen.getByText(CANDIDATE.rule));
    const input = screen.getByDisplayValue(CANDIDATE.rule);
    fireEvent.change(input, { target: { value: "A new rule" } });
    fireEvent.blur(input);
    expect(onRuleChange).toHaveBeenCalledWith("A new rule");
  });
});
