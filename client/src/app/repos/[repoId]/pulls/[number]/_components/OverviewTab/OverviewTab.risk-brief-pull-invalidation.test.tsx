/* OverviewTab.risk-brief-pull-invalidation.test.tsx — specs/cross-cutting/pr-why-risk-brief.

   Acceptance criterion under test (spec.md AC-23 + hooks/risk-brief.ts's own
   documented contract): `useGenerateRiskBrief`'s `onSuccess` invalidates BOTH
   `["pr-risk-brief", prId]` AND `["pull", prId]` (`client/src/lib/hooks/
   risk-brief.ts:38-41`) "since GET /pulls/:id's risk_level field is sourced
   from this same persisted brief." `PrBriefBanner`'s risk badge (AC-23) is
   sourced from `page.tsx`'s `usePullDetail` — a DIFFERENT query than the one
   `RiskBriefCard`'s own regenerate button mutates. No existing test can
   observe whether that cross-query invalidation actually reaches
   `PrBriefBanner`:
     - `RiskBriefCard.test.tsx` mocks `usePrRiskBrief`/`useGenerateRiskBrief`
       directly — no real QueryClient, so no real invalidation ever occurs.
     - `PrBriefBanner.test.tsx` only ever receives `riskLevel` as a static
       prop — it has no opinion on where that prop's value comes from.
     - `OverviewTab.test.tsx` mocks `RiskBriefCard`/`PrBriefBanner` wholesale.
     - `OverviewTab.risk-brief-dedup.test.tsx` (AC-31) covers a different
       cross-cutting concern — that `IntentCard`+`RiskBriefCard` share ONE
       `["pr-risk-brief", prId]` fetch — not this `["pull", prId]`
       invalidation path.
   `OverviewTab` itself never calls `usePullDetail` (by design — it's a pure
   props-in component, see its own file comment); the real integration point
   is one level up, in `page.tsx`. Rather than mounting the full `page.tsx`
   (which pulls in repo lookup, findings/runs polling, blast-radius jump
   logic — none of it relevant here), this test uses a minimal harness that
   reproduces exactly the one piece of real wiring under test: a real
   `usePullDetail` feeding the real `OverviewTab`'s `riskLevel` prop, with the
   real `RiskBriefCard` (rendered inside the real `OverviewTab`) triggering
   the real `useGenerateRiskBrief` mutation — all sharing one QueryClient,
   only `fetch` mocked (client/AGENTS.md convention — no MSW). */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { RiskBrief } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";

import { usePullDetail } from "@/lib/hooks";
import { OverviewTab } from "./OverviewTab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* Minimal reproduction of page.tsx's actual wiring for JUST the piece under
   test: `riskLevel` sourced from `usePullDetail` (["pull", prId]), threaded
   into the real OverviewTab exactly like page.tsx:230 does
   (`riskLevel={pr.risk_level}`). Every other OverviewTab prop is a static
   no-op — this harness intentionally does not reproduce page.tsx's other
   concerns (tab routing, blast-radius jump resolution, etc.). */
function Harness({ prId }: { prId: string }) {
  const { data: pr } = usePullDetail(prId);
  return (
    <OverviewTab
      prBody={null}
      prId={prId}
      reviewSummary={{ verdict: null, score: null, findings: null, latestRunCostUsd: null }}
      onOpenBlast={() => {}}
      onViewInDiff={() => {}}
      prFilePaths={new Set()}
      riskBrief={{ level: pr?.risk_level, flaggedRefs: undefined, onJumpToDiff: () => {} }}
    />
  );
}

function renderHarness(prId: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages, prReview: prReviewMessages }}>
        <Harness prId={prId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
}

const REGENERATED_BRIEF: RiskBrief = {
  what: "Adds rate limiting to public API endpoints.",
  why: "Prevents abuse from unauthenticated clients hammering costly routes.",
  risk_level: "high",
  risks: [],
  review_focus: [],
  pr_head_sha: "def456",
  provider: "openai",
  model: "gpt-4.1",
  generated_at: "2026-08-20T01:00:00.000Z",
};

// The `PrBriefBanner`-rendered risk badge and `RiskBriefCard`'s own
// risk_level badge use identical i18n copy ("Low risk"/"High risk"), so
// queries are scoped to PrBriefBanner's own DOM subtree via its always-
// present empty-state text (verdict is null throughout this test) to avoid
// ambiguity with RiskBriefCard's own badge.
function prBriefBannerRoot(): HTMLElement {
  return screen.getByText(/Run a review to see the PR Brief/).parentElement as HTMLElement;
}

describe("PrBriefBanner risk badge updates after RiskBriefCard regenerate (cross-query invalidation)", () => {
  it("reflects the new risk_level once useGenerateRiskBrief's onSuccess invalidates the real usePullDetail query", async () => {
    // pr.risk_level starts "low"; a regenerate is expected to change it to
    // "high" and for GET /pulls/:id (the real source of PrBriefBanner's
    // badge) to be refetched with the updated value.
    let currentRiskLevel: "low" | "high" = "low";

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/brief") && init?.method === "POST") {
        // Regenerate succeeds — the mocked "server" now considers the PR's
        // persisted risk_level "high" for any subsequent GET /pulls/:id.
        currentRiskLevel = "high";
        return Promise.resolve(
          jsonResponse({ brief: REGENERATED_BRIEF, cached: false }),
        );
      }
      if (u.includes("/brief")) return Promise.resolve(jsonResponse(null));
      if (u.includes("/intent")) return Promise.resolve(jsonResponse(null));
      if (u.includes("/blast")) {
        return Promise.resolve(
          jsonResponse({ changed_symbols: [], downstream: [], summary: "", indexed_sha: null }),
        );
      }
      // Bare GET /pulls/:id (PrDetail) — no further path segment.
      if (/\/pulls\/[^/]+$/.test(u)) {
        return Promise.resolve(jsonResponse({ id: "pr-1", risk_level: currentRiskLevel }));
      }
      throw new Error(`unexpected fetch: ${u} (${init?.method ?? "GET"})`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHarness("pr-1");

    // Initial state: PrBriefBanner's badge reflects the initial "low" value
    // from the first GET /pulls/:id — proves the harness's wiring actually
    // works before the interesting part (the invalidation) is exercised.
    await waitFor(() => expect(within(prBriefBannerRoot()).getByText("Low risk")).toBeInTheDocument());

    // Regenerate is always present regardless of whether a brief already
    // exists (AC-19) — click it to trigger the real useGenerateRiskBrief
    // mutation, exactly as a user would from RiskBriefCard.
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    // The mutation's onSuccess invalidates ["pull", prId] — usePullDetail
    // refetches, picks up the now-"high" risk_level, and PrBriefBanner's
    // badge (sourced purely from that query, one card over from the one the
    // user actually clicked) updates without any direct wiring between the
    // two components.
    await waitFor(() => expect(within(prBriefBannerRoot()).getByText("High risk")).toBeInTheDocument());
    expect(within(prBriefBannerRoot()).queryByText("Low risk")).not.toBeInTheDocument();

    // Sanity: the regenerate really did force a fresh call (not a cache hit).
    const briefPosts = fetchMock.mock.calls.filter(
      (call) => String(call[0]).includes("/brief") && (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(briefPosts).toHaveLength(1);
    const [, postInit] = briefPosts[0] as [string, RequestInit];
    expect(JSON.parse(String(postInit.body))).toEqual({ force: true });
  });
});
