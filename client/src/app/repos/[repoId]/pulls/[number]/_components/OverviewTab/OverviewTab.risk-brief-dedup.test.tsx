/* OverviewTab.risk-brief-dedup.test.tsx — specs/cross-cutting/pr-why-risk-brief.
   `IntentCard` and `RiskBriefCard` each independently call
   `usePrRiskBrief(prId)` (`client/src/lib/hooks/risk-brief.ts`) using the
   SAME TanStack Query key (`["pr-risk-brief", prId]`) — the design's whole
   premise (per spec.md AC-31 / plan.md WI-16) is that mounting both together
   under the real `OverviewTab`, sharing this app's one `QueryClient`, dedupes
   this into ONE network request, not two.

   Every existing test file that touches either component mocks
   `@/lib/hooks/risk-brief` directly (`IntentCard.test.tsx`,
   `RiskBriefCard.test.tsx`), and `OverviewTab.test.tsx` mocks the
   `IntentCard`/`RiskBriefCard` component modules wholesale — by
   construction, none of those can ever observe a real double-fetch
   regression (e.g. a future edit that gives one of the two components its
   own differently-shaped query key). This file deliberately mounts the REAL
   `IntentCard` + `RiskBriefCard` together, sharing one real `QueryClient`,
   with only `fetch` mocked (per client/AGENTS.md's convention — no MSW),
   so a real double-fetch would actually be caught. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { RiskBrief } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

import { IntentCard } from "./_components/IntentCard";
import { RiskBriefCard } from "./_components/RiskBriefCard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderBothCards(prId: string) {
  // Matches the real `QueryClient` defaults (`client/src/lib/providers.tsx`)
  // closely enough to be representative — `staleTime: 30_000` is the exact
  // setting the design's dedup premise cites as "confirmed sound."
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        {/* Mirrors OverviewTab.tsx's own composition: both cards mounted as
            siblings in the same render pass, both self-fetching. */}
        <IntentCard prId={prId} />
        <RiskBriefCard prId={prId} onViewInDiff={() => {}} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as Response;
}

const BASE_BRIEF: RiskBrief = {
  what: "Adds rate limiting to public API endpoints.",
  why: "Prevents abuse from unauthenticated clients hammering costly routes.",
  risk_level: "high",
  risks: [],
  review_focus: [],
  pr_head_sha: "abc123",
  provider: "openai",
  model: "gpt-4.1",
  generated_at: "2026-08-20T00:00:00.000Z",
};

describe("IntentCard + RiskBriefCard mounted together (AC-31 dedup premise)", () => {
  it("issues exactly one GET /pulls/:id/brief request despite two independent usePrRiskBrief consumers", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/brief")) return Promise.resolve(jsonResponse(BASE_BRIEF));
      if (url.includes("/intent")) return Promise.resolve(jsonResponse(null));
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderBothCards("pr-1");

    // Both cards have finished loading their (shared) risk-brief data —
    // RiskBriefCard renders the populated risk_level badge once `brief` data
    // has actually arrived from the (single) network call.
    expect(await screen.findByText("High risk")).toBeInTheDocument();
    // IntentCard's own independent GET /pulls/:id/intent resolved too (its
    // empty state, since this test returns no persisted intent).
    expect(
      await screen.findByText(/No intent has been derived for this PR yet/),
    ).toBeInTheDocument();

    const briefCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/brief"));
    expect(briefCalls).toHaveLength(1);

    // Sanity check the other endpoint too: one IntentCard, one GET /intent.
    const intentCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/intent"));
    expect(intentCalls).toHaveLength(1);
  });

  it("regression guard: a later-mounted second consumer of the same query key does not refetch within staleTime", async () => {
    // A stricter variant of the above that isolates the actual mechanism
    // the design leans on (staleTime-backed cache reuse across renders, not
    // just in-flight-promise sharing for two simultaneously-mounted
    // consumers) — mounts IntentCard first, waits for its fetch to settle,
    // THEN mounts RiskBriefCard against the same QueryClient/prId and
    // asserts it reuses the cached value with zero additional fetches.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/brief")) return Promise.resolve(jsonResponse(BASE_BRIEF));
      if (url.includes("/intent")) return Promise.resolve(jsonResponse(null));
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
          <IntentCard prId="pr-1" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    await screen.findByText(/No intent has been derived for this PR yet/);
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/brief"))).toHaveLength(1),
    );

    rerender(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
          <IntentCard prId="pr-1" />
          <RiskBriefCard prId="pr-1" onViewInDiff={() => {}} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("High risk")).toBeInTheDocument();
    const briefCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/brief"));
    expect(briefCalls).toHaveLength(1);
  });
});
