/* hooks/onboarding.test.tsx — smoke tests for the Onboarding Generator hooks
   (docs/onboarding-generator-plan.md Work Item 12). Mocks `fetch` (no
   API/DB/browser needed, per client/AGENTS.md's testing convention). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OnboardingTourResponse } from "@devdigest/shared";
import { useOnboardingTour, useRegenerateTour } from "./onboarding";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  } as Response;
}

const EMPTY_RESPONSE: OnboardingTourResponse = {
  tour: null,
  indexed_sha: null,
  file_count: null,
  generated_at: null,
  provider: null,
  model: null,
  stale: false,
};

const POPULATED_RESPONSE: OnboardingTourResponse = {
  tour: {
    sections: [
      { kind: "architecture", title: "Architecture overview", body: "...", diagram: null, links: [] },
      { kind: "critical_paths", title: "Critical paths", body: "...", diagram: null, links: [] },
      { kind: "how_to_run", title: "How to run locally", body: "...", diagram: null, links: [] },
      { kind: "reading_path", title: "Guided reading path", body: "...", diagram: null, links: [] },
      { kind: "first_tasks", title: "First tasks", body: "...", diagram: null, links: [] },
    ],
  },
  indexed_sha: "sha1",
  file_count: 42,
  generated_at: "2026-08-19T00:00:00Z",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  stale: false,
};

describe("useOnboardingTour", () => {
  it("fetches GET /repos/:repoId/onboarding and exposes the full data/isLoading/isError/error/refetch shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(EMPTY_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useOnboardingTour("r1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(EMPTY_RESPONSE);
    expect(result.current.isError).toBe(false);
    expect(typeof result.current.refetch).toBe("function");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/repos/r1/onboarding",
      expect.anything(),
    );
  });

  it("stays disabled without a repoId", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useOnboardingTour(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a 422 not_indexed error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "not_indexed", message: "index this repo first" } }, 422));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useOnboardingTour("r1"), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("index this repo first");
  });
});

describe("useRegenerateTour", () => {
  it("POSTs /repos/:repoId/onboarding/regenerate and seeds the onboarding-tour query cache on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(POPULATED_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();

    const { result } = renderHook(() => useRegenerateTour("r1"), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/repos/r1/onboarding/regenerate");
    expect(init.method).toBe("POST");
    expect(qc.getQueryData(["onboarding", "r1"])).toEqual(POPULATED_RESPONSE);
  });

  it("AC-9 — a mocked 502 leaves the GET query's previously-cached tour data untouched", async () => {
    const { qc, wrapper } = makeWrapper();
    // Seed the GET query's cache as if a prior successful load already happened.
    qc.setQueryData(["onboarding", "r1"], POPULATED_RESPONSE);

    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "Onboarding generation failed: provider unreachable" } }, 502));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useRegenerateTour("r1"), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("generation failed");
    // The cache is exactly what it was before the failed mutation — never
    // blanked, never overwritten with a partial/failed response.
    expect(qc.getQueryData(["onboarding", "r1"])).toEqual(POPULATED_RESPONSE);
  });
});
