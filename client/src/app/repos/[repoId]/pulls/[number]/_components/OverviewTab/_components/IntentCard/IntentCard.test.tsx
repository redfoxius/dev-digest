import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Intent, Risk, RiskBrief } from "@devdigest/shared";
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

// `usePrRiskBrief` mocked the same way — controls whether a Risk Brief
// exists yet for this PR (AC-31).
const usePrRiskBrief = vi.fn();
vi.mock("@/lib/hooks/risk-brief", () => ({
  usePrRiskBrief: (...args: unknown[]) => usePrRiskBrief(...args),
}));

import { IntentCard } from "./IntentCard";
import { mergeRisks } from "./helpers";

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
  // Default: no Risk Brief generated yet for this PR — matches the real
  // `GET /pulls/:id/brief` "never generated" response (AC-31).
  usePrRiskBrief.mockReturnValue({ data: null, isLoading: false });
}

function mockRiskBrief(risks: Risk[]) {
  usePrRiskBrief.mockReturnValue({
    data: { risks } as Partial<RiskBrief>,
    isLoading: false,
  });
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

describe("IntentCard — Risk Brief merge (AC-31)", () => {
  it("merges an overlapping-title RiskBrief risk into one chip, using the RiskBrief-sourced fields", () => {
    mockIntent({
      ...BASE_INTENT,
      risks: [
        {
          kind: "security",
          title: "Auth surface touched",
          explanation: "Intent's narrower explanation.",
          severity: "medium",
          file_refs: ["src/auth/session.ts"],
        },
      ],
    });
    mockRiskBrief([
      {
        kind: "security",
        title: "  Auth Surface Touched  ", // same title, different case/whitespace
        explanation: "RiskBrief's richer explanation, from more input signal.",
        severity: "high",
        file_refs: ["src/auth/session.ts", "src/auth/middleware.ts"],
      },
    ]);

    renderWithIntl(<IntentCard prId="pr-1" />);

    // Exactly one chip renders for the matched title (case/whitespace-
    // insensitive match), and it's the RiskBrief-sourced text verbatim
    // (not the Intent-only version's exact casing/spacing).
    expect(screen.getAllByText(/auth surface touched/i)).toHaveLength(1);
    expect(screen.getByText("Auth Surface Touched")).toBeInTheDocument();
    expect(screen.queryByText("Auth surface touched")).not.toBeInTheDocument();
  });

  it("renders today's unchanged Intent-only risks when no Risk Brief has been generated yet", () => {
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
      ],
    });
    // `usePrRiskBrief` returns `{ data: null }` (no brief) via `mockIntent`'s
    // default — explicitly re-asserted here for clarity.
    usePrRiskBrief.mockReturnValue({ data: null, isLoading: false });

    renderWithIntl(<IntentCard prId="pr-1" />);

    expect(screen.getByText("Auth surface touched")).toBeInTheDocument();
  });
});

describe("mergeRisks", () => {
  const intentRisk: Risk = {
    kind: "security",
    title: "Auth surface touched",
    explanation: "Intent's explanation.",
    severity: "medium",
    file_refs: ["src/auth/session.ts"],
  };

  it("returns intentRisks unchanged when briefRisks is undefined (no brief generated yet)", () => {
    expect(mergeRisks([intentRisk], undefined)).toEqual([intentRisk]);
  });

  it("keeps the RiskBrief version and drops the Intent-only duplicate on a case-insensitive, trimmed title match", () => {
    const briefRisk: Risk = {
      ...intentRisk,
      title: "  AUTH SURFACE TOUCHED  ",
      explanation: "RiskBrief's richer explanation.",
      severity: "high",
    };

    const merged = mergeRisks([intentRisk], [briefRisk]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(briefRisk);
  });

  it("keeps a non-matching Intent risk and appends a non-matching RiskBrief risk", () => {
    const intentOnly: Risk = { ...intentRisk, title: "Intent-only risk" };
    const briefOnly: Risk = { ...intentRisk, title: "Brief-only risk", kind: "dependency" };

    const merged = mergeRisks([intentOnly], [briefOnly]);

    expect(merged).toEqual([intentOnly, briefOnly]);
  });

  it("returns an empty array when both sources are empty", () => {
    expect(mergeRisks([], [])).toEqual([]);
  });
});
