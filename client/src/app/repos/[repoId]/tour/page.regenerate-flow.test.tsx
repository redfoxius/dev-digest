/* page.regenerate-flow.test.tsx — AC-22 (spec §6.5): "WHEN a user clicks
   'Regenerate,' the system shall call the regenerate endpoint, disable the
   button with a loading indicator for the call's duration, and ON SUCCESS
   REPLACE THE RENDERED TOUR CONTENT IN PLACE." `page.test.tsx` mocks
   `@/lib/hooks/onboarding` entirely, so its data is fully decoupled from any
   `regenerate.mutate()` call — it can prove the LOADING state (disabled
   button while `isPending`) but structurally cannot prove the SUCCESS path
   actually swaps in-place content, since the rendered `data` there is
   whatever the test hard-codes, never what a real mutation success would
   produce. This file deliberately does NOT mock the hooks module — it uses
   the REAL `useOnboardingTour`/`useRegenerateTour` + a real QueryClient,
   only `fetch` is mocked (per client/AGENTS.md's convention), so a real
   Regenerate click drives the real cache-update path
   (`lib/hooks/onboarding.ts`'s `qc.setQueryData` on success) all the way to
   the rendered page. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingTourResponse } from "@devdigest/shared";
import messages from "../../../../../messages/en/onboarding.json";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "repo1",
    setRepoId: vi.fn(),
    repos: [{ id: "repo1", full_name: "acme/widgets" }],
    activeRepo: { id: "repo1", full_name: "acme/widgets" },
    reposLoaded: true,
  }),
  useRepoNotFound: () => false,
}));

vi.mock("@/lib/toast", () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() },
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import OnboardingTourPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
        <OnboardingTourPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  } as Response;
}

function tourWith(body: string, generatedAt: string): OnboardingTourResponse {
  return {
    tour: {
      sections: [
        { kind: "architecture", title: "Architecture overview", body, diagram: null, links: [] },
        { kind: "critical_paths", title: "Critical paths", body: "...", diagram: null, links: [] },
        { kind: "how_to_run", title: "How to run locally", body: "...", diagram: null, links: [] },
        { kind: "reading_path", title: "Guided reading path", body: "...", diagram: null, links: [] },
        { kind: "first_tasks", title: "First tasks", body: "...", diagram: null, links: [] },
      ],
    },
    indexed_sha: "sha1",
    file_count: 42,
    generated_at: generatedAt,
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    stale: false,
  };
}

describe("OnboardingTourPage — real Regenerate round trip (AC-22)", () => {
  it("on a successful Regenerate, replaces the rendered section content in place and resets 'last refreshed' to just now", async () => {
    const staleGeneratedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString(); // 2h ago
    const initialResponse = tourWith("Old architecture summary.", staleGeneratedAt);
    const freshResponse = tourWith("Freshly regenerated architecture summary.", new Date().toISOString());

    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(jsonResponse(freshResponse));
      return Promise.resolve(jsonResponse(initialResponse));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    // Initial GET-backed render.
    expect(await screen.findByText("Old architecture summary.")).toBeInTheDocument();
    expect(screen.getByText(/last refreshed 2h ago/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    // Regenerate disables the button for the call's duration (AC-22).
    expect(screen.getByRole("button", { name: "Regenerating…" })).toBeDisabled();

    // On success, content is replaced IN PLACE — old body gone, new body
    // shown — and the subtitle's relative time resets to "just now".
    expect(await screen.findByText("Freshly regenerated architecture summary.")).toBeInTheDocument();
    expect(screen.queryByText("Old architecture summary.")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/last refreshed just now/)).toBeInTheDocument());
  });
});
