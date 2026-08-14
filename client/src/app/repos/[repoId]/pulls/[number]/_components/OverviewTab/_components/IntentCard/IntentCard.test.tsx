import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Intent } from "@devdigest/shared";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";

// `usePrIntent`/`useDeriveIntent` are mocked directly (same pattern as
// DiffTab.test.tsx) so each test can control loading/error/empty/data
// states precisely, without a real QueryClientProvider or fetch mock.
const usePrIntent = vi.fn();
const useDeriveIntent = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: (...args: unknown[]) => usePrIntent(...args),
  useDeriveIntent: (...args: unknown[]) => useDeriveIntent(...args),
}));

import { IntentCard } from "./IntentCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const BASE_INTENT: Intent = {
  intent: "Add rate limiting to public API endpoints.",
  in_scope: ["Rate limiter middleware"],
  out_of_scope: [],
  confidence: 0.8,
  evidence_tier: "direct",
  sources: ["pr_description"],
  risks: [],
};

function mockIntent(intent: Intent | null | undefined) {
  usePrIntent.mockReturnValue({
    data: intent,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  useDeriveIntent.mockReturnValue({ isPending: false, mutate: vi.fn() });
}

describe("IntentCard — Risk Areas (Phase 1)", () => {
  it("renders risks as chips with the correct title", () => {
    mockIntent({
      ...BASE_INTENT,
      risks: [
        {
          kind: "security",
          title: "Auth surface touched",
          explanation: "Touches session handling.",
          severity: "high",
          file_refs: ["src/auth/session.ts"],
        },
        {
          kind: "dependency",
          title: "New dependency: ioredis",
          explanation: "Adds a new third-party dependency.",
          severity: "medium",
          file_refs: [],
        },
      ],
    });

    renderWithIntl(<IntentCard prId="pr-1" />);

    expect(screen.getByText("Auth surface touched")).toBeInTheDocument();
    expect(screen.getByText("New dependency: ioredis")).toBeInTheDocument();
  });

  it("shows the noRisks copy and no chip row when risks is empty", () => {
    mockIntent({ ...BASE_INTENT, risks: [] });

    renderWithIntl(<IntentCard prId="pr-1" />);

    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
  });
});

/** Returns true if `a` appears before `b` in document order. */
function isBefore(a: Element, b: Element): boolean {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

const RISK_FIXTURE: Intent = {
  ...BASE_INTENT,
  risks: [
    {
      kind: "security",
      title: "Auth surface touched",
      explanation: "Touches session handling.",
      severity: "high",
      file_refs: ["src/auth/session.ts"],
    },
  ],
};

describe("IntentCard — PR Brief redesign (Phase 3)", () => {
  it("renders sections in order: intent summary -> scope grid -> evidence badge -> Risk Areas heading", () => {
    mockIntent(RISK_FIXTURE);

    renderWithIntl(<IntentCard prId="pr-1" />);

    const summaryEl = screen.getByText(RISK_FIXTURE.intent);
    const scopeGridEl = screen.getByText("In scope");
    const evidenceBadgeEl = screen.getByText(
      "Backed by the PR description and/or a linked spec/ticket",
    );
    const riskHeadingEl = screen.getByText("Risks");

    expect(isBefore(summaryEl, scopeGridEl)).toBe(true);
    expect(isBefore(scopeGridEl, evidenceBadgeEl)).toBe(true);
    expect(isBefore(evidenceBadgeEl, riskHeadingEl)).toBe(true);
  });

  it("renders the Risk Areas sub-header exactly once, distinct from the card's own top-level title", () => {
    mockIntent(RISK_FIXTURE);

    renderWithIntl(<IntentCard prId="pr-1" />);

    // The card's own top-level title ("Intent") and the nested Risk Areas
    // sub-header ("Risks") must both exist, separately, with the risks
    // heading appearing exactly once (guards against ever duplicating the
    // top SectionLabel).
    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.getAllByText("Risks")).toHaveLength(1);
  });

  it("wraps the evidence badge and the Risk Areas heading in their own, separate subsection wrappers", () => {
    mockIntent(RISK_FIXTURE);

    renderWithIntl(<IntentCard prId="pr-1" />);

    const evidenceBadgeEl = screen.getByText(
      "Backed by the PR description and/or a linked spec/ticket",
    );
    const riskHeadingEl = screen.getByText("Risks");

    const evidenceWrapper = evidenceBadgeEl.closest("div");
    const riskWrapper = riskHeadingEl.closest("div")?.parentElement;

    expect(evidenceWrapper).not.toBeNull();
    expect(riskWrapper).not.toBeNull();
    // Structurally distinct wrappers, not one nested inside the other.
    expect(evidenceWrapper).not.toBe(riskWrapper);
    expect(evidenceWrapper?.contains(riskHeadingEl)).toBe(false);
  });
});
