/* hooks/evals.test.tsx — smoke tests for the Eval Pipeline hooks
   (specs/cross-cutting/eval-pipeline). Mocks `fetch` (no API/DB/browser
   needed, per client/AGENTS.md's testing convention) — asserts each hook
   hits the exact route/method/body the server module exposes (spec §10)
   and mirrors `hooks/agents.test.tsx`/`hooks/context-docs.test.tsx`'s
   success-path assertion shape. A representative subset (one query, the
   "invalidates both" mutation) also covers the error path — all hooks share
   the same `api.ts`/`apiFetch` error normalization, so this isn't retested
   per hook. Genuinely new coverage this file adds beyond what the
   component-level tests (`FindingCard.test.tsx`, `EvalsTab.test.tsx`,
   `EvalCaseModal.test.tsx`) already exercise indirectly through mocked
   `useX` hooks: the actual request shape (URL/method/body) each hook sends,
   and `useRunEvalSet`'s AC-31 "invalidates BOTH eval-cases and
   eval-dashboard" contract asserted directly against real invalidation
   calls rather than a mocked hook. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { EvalCase, EvalDashboard, EvalRun, EvalRunResult } from "@devdigest/shared";
import {
  useCreateEvalCaseFromFinding,
  useEvalCases,
  useCreateEvalCase,
  useUpdateEvalCase,
  useDeleteEvalCase,
  useRunEvalCase,
  useRunEvalSet,
  useEvalDashboard,
} from "./evals";

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

const CASE: EvalCase = {
  id: "case1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "Hardcoded Stripe secret key",
  input_diff: "diff --git a/x b/x",
  input_files: null,
  input_meta: null,
  expected_output: { expectations: [{ type: "must_find", file: "src/config.ts", start_line: 11, end_line: 11 }] },
  notes: null,
};

const EVAL_RUN: EvalRun = {
  recall: 1,
  precision: 1,
  citation_accuracy: 1,
  traces_passed: 1,
  traces_total: 1,
  duration_ms: 1200,
  cost_usd: 0.001,
  per_trace: [],
};

const EVAL_RUN_RESULT: EvalRunResult = {
  run_id: "run1",
  case_id: "case1",
  result: EVAL_RUN,
};

const DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 1,
  current: { recall: 1, precision: 1, citation_accuracy: 1, traces_passed: 1, traces_total: 1, cost_usd: 0.001 },
  delta: { recall: 0, precision: 0, citation_accuracy: 0 },
  trend: [],
  recent_runs: [],
  alert: null,
};

describe("useCreateEvalCaseFromFinding (AC-1/AC-2)", () => {
  it("POSTs /findings/:id/eval-case with no body and invalidates that agent's case list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CASE));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useCreateEvalCaseFromFinding(), { wrapper });
    result.current.mutate("f1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/findings/f1/eval-case");
    expect(init.method).toBe("POST");
    expect(result.current.data).toEqual(CASE);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eval-cases", CASE.owner_id] });
  });

  it("surfaces a 422 (undecided finding, AC-3) as an ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: "finding must be accepted or dismissed first" } }, 422),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useCreateEvalCaseFromFinding(), { wrapper });
    result.current.mutate("f2");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("finding must be accepted or dismissed first");
  });
});

describe("useEvalCases", () => {
  it("stays disabled without an agentId", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useEvalCases(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches GET /agents/:id/eval-cases", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([CASE]));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useEvalCases("ag1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([CASE]);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3001/agents/ag1/eval-cases", expect.anything());
  });
});

describe("useCreateEvalCase (AC-6 — owner never client-supplied)", () => {
  it("POSTs the form body to /agents/:id/eval-cases without an owner_kind/owner_id field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CASE));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useCreateEvalCase("ag1"), { wrapper });
    result.current.mutate({
      name: "New case",
      input_diff: "diff --git a/x b/x",
      input_files: null,
      input_meta: null,
      expected_output: { expectations: [] },
      notes: null,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agents/ag1/eval-cases");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.owner_kind).toBeUndefined();
    expect(body.owner_id).toBeUndefined();
    expect(body.name).toBe("New case");
  });
});

describe("useUpdateEvalCase", () => {
  it("PUTs the patch to /agents/:id/eval-cases/:caseId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CASE));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useUpdateEvalCase("ag1"), { wrapper });
    result.current.mutate({ caseId: "case1", patch: { name: "Renamed" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agents/ag1/eval-cases/case1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Renamed" });
  });
});

describe("useDeleteEvalCase", () => {
  it("DELETEs /agents/:id/eval-cases/:caseId and invalidates the case list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useDeleteEvalCase("ag1"), { wrapper });
    result.current.mutate("case1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agents/ag1/eval-cases/case1");
    expect(init.method).toBe("DELETE");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eval-cases", "ag1"] });
  });
});

describe("useRunEvalCase (single-case run, AC-11)", () => {
  it("POSTs /agents/:id/eval-cases/:caseId/run and invalidates the case list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(EVAL_RUN_RESULT));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useRunEvalCase("ag1"), { wrapper });
    result.current.mutate("case1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agents/ag1/eval-cases/case1/run");
    expect(init.method).toBe("POST");
    expect(result.current.data).toEqual(EVAL_RUN_RESULT);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eval-cases", "ag1"] });
  });
});

describe("useRunEvalSet (whole-set run, AC-12/AC-31)", () => {
  it("POSTs /agents/:id/eval-runs and invalidates BOTH the eval-cases list and the eval-dashboard", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(EVAL_RUN));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useRunEvalSet("ag1"), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agents/ag1/eval-runs");
    expect(init.method).toBe("POST");
    // AC-31's own requirement: BOTH query keys must be invalidated, not just
    // the one a mocked-hook component test would already assert against.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eval-cases", "ag1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eval-dashboard", "ag1"] });
  });

  it("surfaces a mid-batch provider failure as an ApiError (AC-14 — the request itself still fails cleanly if the route 5xxs)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "internal error" } }, 500));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useRunEvalSet("ag1"), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("internal error");
  });
});

describe("useEvalDashboard (AC-23)", () => {
  it("stays disabled without an agentId", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useEvalDashboard(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches GET /agents/:id/eval-dashboard", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DASHBOARD));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useEvalDashboard("ag1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(DASHBOARD);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3001/agents/ag1/eval-dashboard", expect.anything());
  });
});
