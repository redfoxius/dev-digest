import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

// jsdom has no real layout engine — scrollIntoView isn't implemented.
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

const TWO_FINDINGS: FindingRecord[] = [
  FINDINGS[0]!,
  {
    id: "f2",
    severity: "SUGGESTION",
    category: "style",
    title: "Low-confidence nit",
    file: "src/other.ts",
    start_line: 4,
    end_line: 4,
    rationale: "Minor.",
    suggestion: null,
    confidence: 0.2, // below LOW_CONFIDENCE_THRESHOLD (0.65)
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel — external scrollToFindingId (Diff → Findings navigation)", () => {
  it("scrolls the matching card into view", () => {
    const { container } = renderWithIntl(
      <FindingsPanel findings={TWO_FINDINGS} prId="pr1" scrollToFindingId="f2" scrollNonce={1} />,
    );
    const el = container.querySelector('[data-finding-id="f2"]');
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect((window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.instances[0]).toBe(el);
  });

  it("un-hides a low-confidence finding when 'hide low confidence' is on and it's the scroll target", () => {
    const { rerender } = renderWithIntl(
      <FindingsPanel findings={TWO_FINDINGS} prId="pr1" />,
    );
    fireEvent.click(screen.getByRole("switch")); // turn "hide low confidence" ON
    expect(screen.queryByText("Low-confidence nit")).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={TWO_FINDINGS} prId="pr1" scrollToFindingId="f2" scrollNonce={1} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Low-confidence nit")).toBeInTheDocument();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("a scrollToFindingId not present in this panel's findings is a no-op — no crash, nothing scrolls", () => {
    renderWithIntl(
      <FindingsPanel findings={FINDINGS} prId="pr1" scrollToFindingId="does-not-exist" scrollNonce={1} />,
    );
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
