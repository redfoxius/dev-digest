/* page.test.tsx — PR Detail page (specs/cross-cutting/eval-pipeline, AC-29).
   The full "Turn into eval case" round trip — page.tsx's own
   `handleTurnIntoEvalCase` wiring `useCreateEvalCaseFromFinding` to a
   success toast, WITHOUT navigating away — has no coverage anywhere else:
   `FindingCard.test.tsx` (11 tests) only proves the button fires its
   `onTurnIntoEvalCase(findingId)` prop; it never renders the real page, so
   it can't see whether that prop is actually wired to the mutation hook, or
   whether a toast fires on success. This is the one dedicated `page.tsx`
   test for this route — precedent for testing a `page.tsx` directly exists
   elsewhere (`context/page.test.tsx`, `tour/page.test.tsx`), both of which
   mock every data-fetching hook + `next/navigation` + `@/components/app-shell`
   and let real child components render. This page has far more hooks/tabs
   than either precedent, so — to keep the test scoped to the one behavior
   under test rather than re-deriving PrDetailHeader/OverviewTab/DiffTab/
   BlastTab's own already-tested-elsewhere behavior — this test additionally
   mocks `PrDetailHeader` and `FindingsTab` (the two components reachable on
   the `tab=findings` render path this test forces via `useSearchParams`),
   invoking the real `FindingsTab`'s `onTurnIntoEvalCase` prop through a
   stub button rather than re-rendering the whole findings tree FindingCard
   itself already covers. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrDetail, PrMeta, EvalCase } from "@devdigest/shared";
import messages from "../../../../../../messages/en/prReview.json";

const {
  usePullDetailMock,
  usePullsMock,
  createEvalCaseMutate,
  toastSuccess,
  routerPush,
  routerReplace,
} = vi.hoisted(() => ({
  usePullDetailMock: vi.fn(),
  usePullsMock: vi.fn(),
  createEvalCaseMutate: vi.fn(),
  toastSuccess: vi.fn(),
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo1", number: "42" }),
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  useSearchParams: () => ({
    get: (key: string) => (key === "tab" ? "findings" : null),
    toString: () => "tab=findings",
  }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "repo1", full_name: "acme/widgets" },
  }),
  useRepoNotFound: () => false,
}));

vi.mock("../../../../../lib/hooks", () => ({
  usePulls: usePullsMock,
  usePullDetail: usePullDetailMock,
}));

vi.mock("../../../../../lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: [], refetch: vi.fn() }),
  useCancelRun: () => ({ mutate: vi.fn() }),
  usePrActiveRuns: () => ({ data: [] }),
  usePrRuns: () => ({ data: [] }),
  useDeleteRun: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/lib/hooks/blast", () => ({
  usePrBlastRadius: () => ({ data: undefined }),
}));

vi.mock("@/lib/hooks/risk-brief", () => ({
  usePrRiskBrief: () => ({ data: undefined }),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutate: createEvalCaseMutate }),
}));

vi.mock("../../../../../lib/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

vi.mock("../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./_components/PrDetailHeader", () => ({
  PrDetailHeader: () => <div data-testid="pr-detail-header" />,
}));

vi.mock("./_components/FindingsTab", () => ({
  FindingsTab: ({ onTurnIntoEvalCase }: { onTurnIntoEvalCase?: (findingId: string) => void }) => (
    <button onClick={() => onTurnIntoEvalCase?.("f1")}>trigger-turn-into-eval-case</button>
  ),
}));

import PRDetailPage from "./page";

const PR_META: PrMeta = {
  id: "pr1",
  number: 42,
  title: "Fix retry logic",
  author: "octocat",
  branch: "feature/retry",
  base: "main",
  head_sha: "abc123",
  additions: 10,
  deletions: 2,
  files_count: 1,
  status: "open",
};

const PR_DETAIL: PrDetail = {
  ...PR_META,
  body: "PR body",
  files: [],
  commits: [],
};

const EVAL_CASE: EvalCase = {
  id: "case1",
  owner_kind: "agent",
  owner_id: "agent1",
  name: "Hardcoded Stripe secret key",
  input_diff: "diff --git a/x b/x",
  input_files: null,
  input_meta: null,
  expected_output: { expectations: [] },
  notes: null,
};

afterEach(() => {
  cleanup();
  createEvalCaseMutate.mockClear();
  toastSuccess.mockClear();
  routerPush.mockClear();
  routerReplace.mockClear();
  usePullDetailMock.mockReset();
  usePullsMock.mockReset();
});

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <PRDetailPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("PRDetailPage — turn into eval case wiring (AC-29)", () => {
  it("on success, shows a toast naming the created case without navigating away", async () => {
    usePullsMock.mockReturnValue({ data: [PR_META], isLoading: false });
    usePullDetailMock.mockReturnValue({
      data: PR_DETAIL,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    createEvalCaseMutate.mockImplementation(
      (_findingId: string, opts?: { onSuccess?: (c: EvalCase) => void }) => {
        opts?.onSuccess?.(EVAL_CASE);
      },
    );

    renderPage();
    fireEvent.click(screen.getByText("trigger-turn-into-eval-case"));

    expect(createEvalCaseMutate).toHaveBeenCalledWith("f1", expect.anything());
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("Hardcoded Stripe secret key")),
    );
    // No navigation — AC-29's "without navigating away from the PR page".
    expect(routerPush).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("a failed mutation shows no success toast (no onError branch to swallow the failure silently)", async () => {
    usePullsMock.mockReturnValue({ data: [PR_META], isLoading: false });
    usePullDetailMock.mockReturnValue({
      data: PR_DETAIL,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    createEvalCaseMutate.mockImplementation(() => {
      // Simulates a real mutation failure — onSuccess never fires.
    });

    renderPage();
    fireEvent.click(screen.getByText("trigger-turn-into-eval-case"));

    expect(createEvalCaseMutate).toHaveBeenCalledWith("f1", expect.anything());
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
