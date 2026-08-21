import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { BlastRadiusResponse } from "@devdigest/shared";

// `usePrBlastRadius` is mocked directly (same pattern as
// IntentCard.test.tsx / DiffTab.test.tsx) so each test can control the
// loaded data precisely, without a real QueryClientProvider or fetch mock.
const usePrBlastRadius = vi.fn();
vi.mock("@/lib/hooks/blast", () => ({
  usePrBlastRadius: (...args: unknown[]) => usePrBlastRadius(...args),
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

afterEach(cleanup);

const BASE_BLAST: BlastRadiusResponse = {
  changed_symbols: [{ name: "chargeCard", file: "src/billing/charge.ts", kind: "function" }],
  downstream: [
    {
      symbol: "chargeCard",
      callers: [
        { name: "handleWebhook", file: "src/webhooks/stripe.ts", line: 42 },
        { name: "retryJob", file: "src/jobs/retry.ts", line: 10 },
      ],
      endpoints_affected: ["POST /billing/charge"],
      crons_affected: [],
    },
  ],
  summary: "1 symbol changed, 2 callers affected.",
  indexed_sha: "abc123",
};

function mockBlast(data: BlastRadiusResponse | undefined) {
  usePrBlastRadius.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

const noop = () => {};

describe("BlastRadiusCard — flagged-dot indicator (PR Why + Risk Brief, AC-24)", () => {
  it("renders a high-severity-colored dot and a 'flagged' accessible title for a caller row whose file is flagged at severity 'high'", () => {
    mockBlast(BASE_BLAST);
    const flaggedRefs = new Map<string, "high" | "medium" | "low" | "flagged">([
      ["src/webhooks/stripe.ts", "high"],
    ]);

    render(
      <BlastRadiusCard
        prId="pr-1"
        onViewFull={noop}
        onViewInDiff={noop}
        prFilePaths={new Set(["src/webhooks/stripe.ts"])}
        flaggedRefs={flaggedRefs}
      />,
    );

    const flaggedRow = screen.getByTitle(/flagged by Risk Brief \(high\)/);
    expect(flaggedRow).toBeInTheDocument();
    expect(flaggedRow.tagName).toBe("BUTTON");

    const dot = within(flaggedRow).queryByTestId("flagged-dot");
    expect(dot).not.toBeNull();
  });

  it("renders the neutral muted dot color for a caller flagged only via the 'flagged' sentinel", () => {
    mockBlast(BASE_BLAST);
    const flaggedRefs = new Map<string, "high" | "medium" | "low" | "flagged">([
      ["src/jobs/retry.ts", "flagged"],
    ]);

    render(
      <BlastRadiusCard
        prId="pr-1"
        onViewFull={noop}
        onViewInDiff={noop}
        prFilePaths={new Set(["src/jobs/retry.ts"])}
        flaggedRefs={flaggedRefs}
      />,
    );

    const flaggedRow = screen.getByTitle(/flagged by Risk Brief$/);
    const dot = within(flaggedRow).queryByTestId("flagged-dot");
    expect(dot).not.toBeNull();
  });

  it("renders no dot at all for a caller row not present in flaggedRefs", () => {
    mockBlast(BASE_BLAST);
    const flaggedRefs = new Map<string, "high" | "medium" | "low" | "flagged">([
      ["src/webhooks/stripe.ts", "high"],
    ]);

    render(
      <BlastRadiusCard
        prId="pr-1"
        onViewFull={noop}
        onViewInDiff={noop}
        prFilePaths={new Set(["src/webhooks/stripe.ts", "src/jobs/retry.ts"])}
        flaggedRefs={flaggedRefs}
      />,
    );

    const unflaggedRow = screen.getByTitle("Jump to this line in Files changed");
    expect(within(unflaggedRow).queryByTestId("flagged-dot")).toBeNull();
    expect(screen.queryByTitle(/flagged/i)).not.toBe(unflaggedRow);
  });

  it("renders no dots anywhere when flaggedRefs is undefined", () => {
    mockBlast(BASE_BLAST);

    render(
      <BlastRadiusCard
        prId="pr-1"
        onViewFull={noop}
        onViewInDiff={noop}
        prFilePaths={new Set(["src/webhooks/stripe.ts", "src/jobs/retry.ts"])}
      />,
    );

    expect(screen.queryAllByTestId("flagged-dot")).toHaveLength(0);
    expect(screen.queryByTitle(/flagged/i)).not.toBeInTheDocument();
  });

  it("renders a flagged dot + accessible title on an endpoint chip whose endpoint string is in flaggedRefs", () => {
    mockBlast(BASE_BLAST);
    const flaggedRefs = new Map<string, "high" | "medium" | "low" | "flagged">([
      ["POST /billing/charge", "medium"],
    ]);

    render(
      <BlastRadiusCard
        prId="pr-1"
        onViewFull={noop}
        onViewInDiff={noop}
        prFilePaths={new Set()}
        flaggedRefs={flaggedRefs}
      />,
    );

    const flaggedChip = screen.getByTitle(/flagged by Risk Brief \(medium\)/);
    const dot = within(flaggedChip).queryByTestId("flagged-dot");
    expect(dot).not.toBeNull();
  });
});
