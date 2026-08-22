/* hooks/context-docs.test.tsx — smoke tests for the Project Context Folder
   hooks (repo-scoped discovery/reindex/preview/config + Agent/Skill Context
   tab attach/enable/reorder). Mocks `fetch` (no API/DB/browser needed, per
   client/AGENTS.md's testing convention) — asserts each hook hits the exact
   route/method/body the server module exposes (spec §10) and mirrors
   `hooks/agents.test.tsx`'s success-path assertion shape. A representative
   subset of hooks (one query, one full-envelope mutation, one bulk-POST
   reorder, one PATCH toggle) also cover the error path — all 11 hooks share
   the same `api.ts`/`apiFetch` error normalization, so this isn't retested
   per hook (fully mechanical repetition; see `docs/project-context-folder-plan.md`
   Work Item 12's acceptance note). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type {
  AgentContextDocLink,
  ContextDocument,
  ContextSearchConfig,
  SkillContextDocLink,
} from "@devdigest/shared";
import {
  useAgentContextDocs,
  useContextConfig,
  useContextDocPreview,
  useContextDocs,
  useReindexContextDocs,
  useSetAgentContextDocEnabled,
  useSetAgentContextDocs,
  useSetContextConfig,
  useSetSkillContextDocEnabled,
  useSetSkillContextDocs,
  useSkillContextDocs,
  type ContextDocPreview,
  type ContextDocsResponse,
} from "./context-docs";

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

const DOC: ContextDocument = {
  id: "doc1",
  path: "specs/public-api.md",
  root: "specs",
  size_bytes: 1024,
  chunk_count: 3,
  index_status: "indexed",
  used_by_agents: 1,
  used_by_skills: 0,
  last_indexed_at: "2026-08-19T00:00:00Z",
};

const DOCS_RESPONSE: ContextDocsResponse = {
  documents: [DOC],
  index_status: "indexed",
  file_count: 1,
  total_chunk_count: 3,
  last_indexed_at: "2026-08-19T00:00:00Z",
  coverage_percent: 100,
};

const AGENT_LINKS: AgentContextDocLink[] = [
  { path: "specs/public-api.md", order: 0, enabled: true, document: DOC },
];

const SKILL_LINKS: SkillContextDocLink[] = [
  { path: "specs/public-api.md", order: 0, enabled: false, document: DOC },
];

const CONFIG: ContextSearchConfig = { excludes: ["**/{specs,docs,insights}/**/*.md"] };

describe("useContextDocs", () => {
  it("fetches GET /repos/:repoId/context-docs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DOCS_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useContextDocs("r1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(DOCS_RESPONSE);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/repos/r1/context-docs",
      expect.anything(),
    );
  });

  it("stays disabled without a repoId", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useContextDocs(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a 500 as an ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "boom" } }, 500));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useContextDocs("r1"), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("boom");
  });
});

describe("useReindexContextDocs", () => {
  it("POSTs /repos/:repoId/context-docs/reindex and seeds the context-docs cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DOCS_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();

    const { result } = renderHook(() => useReindexContextDocs("r1"), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/repos/r1/context-docs/reindex");
    expect(init.method).toBe("POST");
    expect(qc.getQueryData(["context-docs", "r1"])).toEqual(DOCS_RESPONSE);
  });

  it("surfaces a 500 as an ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "reindex failed" } }, 500));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useReindexContextDocs("r1"), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("reindex failed");
  });
});

describe("useContextDocPreview", () => {
  it("fetches GET /repos/:repoId/context-docs/preview?path=... with the path percent-encoded", async () => {
    const preview: ContextDocPreview = { path: "specs/public-api.md", content: "# API" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(preview));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useContextDocPreview("r1", "specs/public-api.md"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(preview);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/repos/r1/context-docs/preview?path=specs%2Fpublic-api.md",
      expect.anything(),
    );
  });

  it("stays disabled without a path", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useContextDocPreview("r1", undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useContextConfig", () => {
  it("fetches GET /repos/:repoId/context-config", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CONFIG));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useContextConfig("r1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(CONFIG);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/repos/r1/context-config",
      expect.anything(),
    );
  });
});

describe("useSetContextConfig", () => {
  it("PUTs { excludes } to /repos/:repoId/context-config and seeds the config cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CONFIG));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();

    const { result } = renderHook(() => useSetContextConfig("r1"), { wrapper });
    result.current.mutate(CONFIG.excludes);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/repos/r1/context-config");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ excludes: CONFIG.excludes });
    expect(qc.getQueryData(["context-config", "r1"])).toEqual(CONFIG);
  });

  it("persists a clonePath-escaping-looking exclude pattern (excludes can only narrow, never widen, an already-bounded scan)", async () => {
    const escapingConfig: ContextSearchConfig = { excludes: ["../../etc/**/*.md"] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(escapingConfig));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();

    const { result } = renderHook(() => useSetContextConfig("r1"), { wrapper });
    result.current.mutate(["../../etc/**/*.md"]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/repos/r1/context-config");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ excludes: ["../../etc/**/*.md"] });
    expect(result.current.data).toEqual(escapingConfig);
    expect(qc.getQueryData(["context-config", "r1"])).toEqual(escapingConfig);
  });
});

describe("useAgentContextDocs", () => {
  it("fetches GET /agents/:id/context-docs?repo_id=..., ordered as the server returns it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(AGENT_LINKS));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useAgentContextDocs("ag1", "r1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(AGENT_LINKS);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/agents/ag1/context-docs?repo_id=r1",
      expect.anything(),
    );
  });

  it("stays disabled without a repoId", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useAgentContextDocs("ag1", undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useSetAgentContextDocs (drag-reorder / full-replace)", () => {
  it("POSTs the full ordered paths array and invalidates this agent's links", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(AGENT_LINKS));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useSetAgentContextDocs("ag1", "r1"), { wrapper });
    result.current.mutate(["specs/public-api.md", "docs/setup.md"]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agents/ag1/context-docs?repo_id=r1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      paths: ["specs/public-api.md", "docs/setup.md"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent-context-docs", "ag1", "r1"] });
  });

  it("surfaces a 404 (cross-workspace agent) as an ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "not found" } }, 404));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSetAgentContextDocs("missing", "r1"), { wrapper });
    result.current.mutate(["specs/public-api.md"]);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("not found");
  });
});

describe("useSetAgentContextDocEnabled (row checkbox)", () => {
  it("PATCHes /agents/:id/context-docs/:path (percent-encoded) with { enabled } and invalidates links", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(AGENT_LINKS));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useSetAgentContextDocEnabled("ag1", "r1"), { wrapper });
    result.current.mutate({ path: "specs/public-api.md", enabled: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:3001/agents/ag1/context-docs/specs%2Fpublic-api.md?repo_id=r1",
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ enabled: true });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent-context-docs", "ag1", "r1"] });
  });

  it("surfaces a 404 (unattached/unknown path) as an ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "not found" } }, 404));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSetAgentContextDocEnabled("ag1", "r1"), { wrapper });
    result.current.mutate({ path: "specs/missing.md", enabled: true });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("not found");
  });
});

describe("useSkillContextDocs", () => {
  it("fetches GET /skills/:id/context-docs?repo_id=..., ordered as the server returns it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SKILL_LINKS));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSkillContextDocs("sk1", "r1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(SKILL_LINKS);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/skills/sk1/context-docs?repo_id=r1",
      expect.anything(),
    );
  });

  it("stays disabled without a repoId", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSkillContextDocs("sk1", undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useSetSkillContextDocs (drag-reorder / full-replace)", () => {
  it("POSTs the full ordered paths array and invalidates this skill's links", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SKILL_LINKS));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useSetSkillContextDocs("sk1", "r1"), { wrapper });
    result.current.mutate(["specs/public-api.md"]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/skills/sk1/context-docs?repo_id=r1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ paths: ["specs/public-api.md"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skill-context-docs", "sk1", "r1"] });
  });
});

describe("useSetSkillContextDocEnabled (row checkbox)", () => {
  it("PATCHes /skills/:id/context-docs/:path (percent-encoded) with { enabled } and invalidates links", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SKILL_LINKS));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useSetSkillContextDocEnabled("sk1", "r1"), { wrapper });
    result.current.mutate({ path: "specs/public-api.md", enabled: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:3001/skills/sk1/context-docs/specs%2Fpublic-api.md?repo_id=r1",
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ enabled: false });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skill-context-docs", "sk1", "r1"] });
  });
});
