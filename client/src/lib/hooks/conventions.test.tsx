/* hooks/conventions.test.tsx — smoke tests for the Conventions Extractor
   hooks. Mocks `fetch` (no API/DB/browser needed, per client/AGENTS.md's
   testing convention) — asserts each hook hits the exact route the server
   module exposes (server/src/modules/conventions/routes.ts). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ConventionCandidate, Skill } from "@devdigest/shared";
import {
  useConventions,
  useCreateSkillFromConventions,
  useExtractConventions,
  useSkillDraftFromConventions,
  useUpdateConvention,
} from "./conventions";

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

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  rule: "Always use async/await",
  category: "error-handling",
  evidence_path: "src/api/users.ts",
  evidence_snippet: "await db.users.find(id);",
  evidence_line_start: 4,
  evidence_line_end: 4,
  confidence: 0.9,
  status: "accepted",
  origin: "model",
};

describe("useConventions", () => {
  it("fetches GET /repos/:id/conventions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([CANDIDATE]));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useConventions("r1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([CANDIDATE]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/repos/r1/conventions"),
      expect.anything(),
    );
  });
});

describe("useExtractConventions", () => {
  it("posts to POST /repos/:id/conventions/extract", async () => {
    const response = { candidates: [CANDIDATE], sample_file_count: 5, scanned_at: "2026-08-07T00:00:00Z" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(response));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useExtractConventions("r1"), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/repos/r1/conventions/extract");
    expect(init.method).toBe("POST");
  });
});

describe("useUpdateConvention", () => {
  it("PATCHes /conventions/:id with the given patch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...CANDIDATE, status: "rejected" }));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useUpdateConvention("r1"), { wrapper });
    result.current.mutate({ id: "c1", patch: { status: "rejected" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/conventions/c1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ status: "rejected" });
  });
});

describe("useSkillDraftFromConventions", () => {
  it("posts candidate_ids to POST /repos/:id/conventions/skill-draft", async () => {
    const draft = { name: "repo-conventions", description: "1 rule", body: "# repo-conventions", token_count: 10 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(draft));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSkillDraftFromConventions("r1"), { wrapper });
    result.current.mutate(["c1", "c2"]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(draft);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/repos/r1/conventions/skill-draft");
    expect(JSON.parse(init.body)).toEqual({ candidate_ids: ["c1", "c2"] });
  });
});

describe("useCreateSkillFromConventions", () => {
  it("posts the full body to POST /repos/:id/conventions/skill", async () => {
    const skill: Skill = {
      id: "sk1",
      name: "repo-conventions",
      description: "",
      type: "convention",
      source: "extracted",
      body: "# repo-conventions",
      enabled: true,
      version: 1,
      evidence_files: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(skill, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useCreateSkillFromConventions("r1"), { wrapper });
    result.current.mutate({
      candidate_ids: ["c1"],
      name: "repo-conventions",
      description: "",
      body: "# repo-conventions",
      type: "convention",
      enabled: true,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(skill);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/repos/r1/conventions/skill");
  });
});
