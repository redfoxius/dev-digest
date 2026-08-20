import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RiskBrief, RiskBriefGenerateResult } from "@devdigest/shared";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";

// `usePrRiskBrief`/`useGenerateRiskBrief` are mocked directly (same pattern
// as `IntentCard.test.tsx`) so each test can control loading/error/empty/
// degraded/populated states precisely, without a real QueryClientProvider
// or fetch mock.
const usePrRiskBrief = vi.fn();
const useGenerateRiskBrief = vi.fn();
vi.mock("@/lib/hooks/risk-brief", () => ({
  usePrRiskBrief: (...args: unknown[]) => usePrRiskBrief(...args),
  useGenerateRiskBrief: (...args: unknown[]) => useGenerateRiskBrief(...args),
}));

import { RiskBriefCard } from "./RiskBriefCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const BASE_BRIEF: RiskBrief = {
  what: "Adds rate limiting to public API endpoints.",
  why: "Prevents abuse from unauthenticated clients hammering costly routes.",
  risk_level: "high",
  risks: [
    {
      kind: "security",
      title: "Auth surface touched",
      explanation: "Touches session handling.",
      severity: "high",
      file_refs: ["src/middleware/ratelimit.ts"],
    },
  ],
  review_focus: [
    {
      file: "src/config.ts",
      line: 12,
      reason: "live Stripe key committed in plaintext",
    },
  ],
  pr_head_sha: "abc123",
  provider: "openai",
  model: "gpt-4.1",
  generated_at: "2026-08-20T00:00:00.000Z",
};

function mockRiskBrief(data: RiskBrief | null, overrides: Partial<Record<string, unknown>> = {}) {
  usePrRiskBrief.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  });
}

function mockGenerate(overrides: Partial<Record<string, unknown>> = {}) {
  const mutate = vi.fn();
  useGenerateRiskBrief.mockReturnValue({
    data: undefined,
    isPending: false,
    mutate,
    ...overrides,
  });
  return mutate;
}

const noop = () => {};

describe("RiskBriefCard — empty state (AC-18)", () => {
  it("renders the empty state when GET returns null, and its Generate click fires the mutation with force: false", () => {
    mockRiskBrief(null);
    const mutate = mockGenerate();

    renderWithIntl(<RiskBriefCard prId="pr-1" onViewInDiff={noop} />);

    expect(screen.getByText("No risk brief yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate risk brief" }));

    expect(mutate).toHaveBeenCalledWith({ force: false });
  });
});

describe("RiskBriefCard — Regenerate control (AC-19)", () => {
  it("is always present, in both the empty and populated states, and always fires the mutation with force: true", () => {
    mockRiskBrief(null);
    const mutateEmpty = mockGenerate();
    const { unmount } = renderWithIntl(<RiskBriefCard prId="pr-1" onViewInDiff={noop} />);

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(mutateEmpty).toHaveBeenCalledWith({ force: true });
    unmount();
    cleanup();

    mockRiskBrief(BASE_BRIEF);
    const mutatePopulated = mockGenerate();
    renderWithIntl(<RiskBriefCard prId="pr-1" onViewInDiff={noop} />);

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(mutatePopulated).toHaveBeenCalledWith({ force: true });
  });
});

describe("RiskBriefCard — populated state (AC-17, AC-28)", () => {
  it("renders the risk_level badge, what/why, risks[], and review_focus[] rows with accessible file:line + reason names", () => {
    mockRiskBrief(BASE_BRIEF);
    mockGenerate();

    renderWithIntl(<RiskBriefCard prId="pr-1" onViewInDiff={noop} />);

    expect(screen.getByText("High risk")).toBeInTheDocument();
    expect(screen.getByText(BASE_BRIEF.what)).toBeInTheDocument();
    expect(screen.getByText(BASE_BRIEF.why)).toBeInTheDocument();
    expect(screen.getByText("Auth surface touched")).toBeInTheDocument();

    const focusRow = screen.getByRole("button", {
      name: "src/config.ts:12 — live Stripe key committed in plaintext",
    });
    expect(focusRow).toBeInTheDocument();
  });

  it("calls onViewInDiff with the exact {file, line} when a review-focus row is clicked", () => {
    mockRiskBrief(BASE_BRIEF);
    mockGenerate();
    const onViewInDiff = vi.fn();

    renderWithIntl(<RiskBriefCard prId="pr-1" onViewInDiff={onViewInDiff} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "src/config.ts:12 — live Stripe key committed in plaintext",
      }),
    );

    expect(onViewInDiff).toHaveBeenCalledWith("src/config.ts", 12);
  });
});

describe("RiskBriefCard — degraded result (AC-21)", () => {
  it("renders the error state, not a fabricated normal layout, when the last mutation resolved with a degraded_reason", () => {
    mockRiskBrief(null);
    const degradedResult: RiskBriefGenerateResult = { brief: null, degraded_reason: "llm_failed" };
    mockGenerate({ data: degradedResult });

    renderWithIntl(<RiskBriefCard prId="pr-1" onViewInDiff={noop} />);

    expect(screen.getByText("Couldn't generate a risk brief")).toBeInTheDocument();
    expect(screen.queryByText("High risk")).not.toBeInTheDocument();
    expect(screen.queryByText("Medium risk")).not.toBeInTheDocument();
    expect(screen.queryByText("Low risk")).not.toBeInTheDocument();
    expect(screen.queryByText("No notable risks flagged.")).not.toBeInTheDocument();
    expect(screen.queryByText("No specific review focus flagged.")).not.toBeInTheDocument();
  });

  it("still shows the error state even when a prior, still-persisted brief exists in the GET cache", () => {
    mockRiskBrief(BASE_BRIEF);
    const degradedResult: RiskBriefGenerateResult = { brief: null, degraded_reason: "input_too_large" };
    mockGenerate({ data: degradedResult });

    renderWithIntl(<RiskBriefCard prId="pr-1" onViewInDiff={noop} />);

    expect(screen.getByText("This PR is too large to summarize")).toBeInTheDocument();
    expect(screen.queryByText(BASE_BRIEF.what)).not.toBeInTheDocument();
  });
});
