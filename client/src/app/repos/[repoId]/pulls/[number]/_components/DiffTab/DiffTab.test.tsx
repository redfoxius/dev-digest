import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SmartDiff } from "@devdigest/shared";
import type { PrFile, PrReviewComment } from "@/lib/types";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";

// `usePrSmartDiff`/`usePrComments`/`useCreatePrComment` are mocked directly
// (same pattern as PRRow.test.tsx / ReviewRunAccordion.test.tsx) so each test
// can control loading/error/empty/data states precisely, without a real
// QueryClientProvider or fetch mock.
const usePrSmartDiff = vi.fn();
vi.mock("@/lib/hooks/smart-diff", () => ({
  usePrSmartDiff: (...args: unknown[]) => usePrSmartDiff(...args),
}));

const usePrComments = vi.fn();
const useCreatePrComment = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: (...args: unknown[]) => usePrComments(...args),
  useCreatePrComment: (...args: unknown[]) => useCreatePrComment(...args),
}));

import { DiffTab } from "./DiffTab";

afterEach(cleanup);

// jsdom has no real layout engine — FileCard's scroll-to-line effect (used by
// SmartDiffViewer's findings Chip) needs scrollIntoView stubbed.
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const PATCH_CORE = "@@ -3,1 +4,2 @@\n+line four\n+line five\n";
const PATCH_WIRING = "@@ -1,1 +1,1 @@\n+export default {}\n";

const FILES: PrFile[] = [
  { path: "src/api/handler.ts", additions: 3, deletions: 1, patch: PATCH_CORE },
  { path: "vite.config.ts", additions: 5, deletions: 2, patch: PATCH_WIRING },
];

const NON_EMPTY_SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/api/handler.ts",
          pseudocode_summary: null,
          additions: 3,
          deletions: 1,
          findings_count: 0,
          finding_lines: [],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        {
          path: "vite.config.ts",
          pseudocode_summary: null,
          additions: 5,
          deletions: 2,
          findings_count: 0,
          finding_lines: [],
        },
      ],
    },
    { role: "boilerplate", files: [] },
  ],
  split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
};

const EMPTY_SMART_DIFF: SmartDiff = {
  groups: [
    { role: "core", files: [] },
    { role: "wiring", files: [] },
    { role: "boilerplate", files: [] },
  ],
  split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
};

function comment(o: Partial<PrReviewComment> = {}): PrReviewComment {
  return {
    id: 1,
    path: "src/api/handler.ts",
    line: 4,
    original_line: null,
    side: "RIGHT",
    body: "Looks good.",
    user: "reviewer",
    created_at: "2026-06-11T18:00:00.000Z",
    html_url: "https://github.com/o/r/pull/1#comment-1",
    in_reply_to_id: null,
    is_outdated: false,
    ...o,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: prReviewMessages, shell: shellMessages }}
    >
      <DiffTab prId="pr-1" filesCount={FILES.length} files={FILES} canComment />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab — smart-order toggle availability", () => {
  it("is absent while smart-diff is loading, errored, or empty — always falling back to the flat DiffViewer", () => {
    usePrComments.mockReturnValue({ data: [] });
    useCreatePrComment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });

    for (const smartDiffState of [
      { data: undefined, isLoading: true, isError: false },
      { data: undefined, isLoading: false, isError: true },
      { data: EMPTY_SMART_DIFF, isLoading: false, isError: false },
    ]) {
      usePrSmartDiff.mockReturnValue(smartDiffState);
      const { unmount } = renderTab();

      expect(screen.queryByRole("button", { name: "Smart order" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Original order" })).not.toBeInTheDocument();
      // Falls back to the flat DiffViewer — no grouped section headers.
      expect(screen.queryByRole("button", { name: /^Core\b/i })).not.toBeInTheDocument();
      // The flat DiffViewer still renders every file.
      expect(screen.getByText("src/api/handler.ts")).toBeInTheDocument();
      expect(screen.getByText("vite.config.ts")).toBeInTheDocument();

      unmount();
    }
  });
});

describe("DiffTab — smart-order toggle", () => {
  it("is present and defaults to Smart order once smartDiff has a non-empty group", () => {
    usePrComments.mockReturnValue({ data: [] });
    useCreatePrComment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    usePrSmartDiff.mockReturnValue({ data: NON_EMPTY_SMART_DIFF, isLoading: false, isError: false });

    renderTab();

    expect(screen.getByRole("button", { name: "Smart order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Original order" })).toBeInTheDocument();
    // Smart order is the default — the grouped SmartDiffViewer is rendered,
    // evidenced by its role section headers (the flat DiffViewer has none).
    expect(screen.getByRole("button", { name: /^Core\b/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Wiring\b/i })).toBeInTheDocument();
  });

  it("flipping to Original order swaps to the flat DiffViewer without losing commenting behavior", () => {
    usePrComments.mockReturnValue({ data: [comment()] });
    useCreatePrComment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    usePrSmartDiff.mockReturnValue({ data: NON_EMPTY_SMART_DIFF, isLoading: false, isError: false });

    renderTab();

    // Starts grouped (Smart order default) with the comments button available.
    expect(screen.getByRole("button", { name: /^Core\b/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show comments \(1\)/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Original order" }));

    // Grouped section headers are gone — the flat DiffViewer is now rendered...
    expect(screen.queryByRole("button", { name: /^Core\b/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Wiring\b/i })).not.toBeInTheDocument();
    // ...but both files are still shown, and the comments-visibility button
    // still works exactly as before.
    expect(screen.getByText("src/api/handler.ts")).toBeInTheDocument();
    expect(screen.getByText("vite.config.ts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Show comments \(1\)/ }));
    expect(screen.getByRole("button", { name: /Hide comments \(1\)/ })).toBeInTheDocument();
  });
});
