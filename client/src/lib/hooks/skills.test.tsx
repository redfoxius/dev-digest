/* hooks/skills.test.ts — smoke tests for the A1 Skills hooks. Mocks `fetch`
   (no API/DB/browser needed, per client/AGENTS.md's testing convention) and
   drives each hook through @testing-library/react's `renderHook`. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { CommunitySkill, Skill, SkillVersion } from "@devdigest/shared";
import {
  useCommunitySkills,
  useCreateSkill,
  useDeleteSkill,
  useImportFileConfirm,
  useImportFilePreview,
  useImportUrlConfirm,
  useImportUrlPreview,
  useInstallCommunitySkill,
  useRestoreSkillVersion,
  useSkill,
  useSkillVersions,
  useSkills,
  useUpdateSkill,
} from "./skills";

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

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rates PR quality",
  type: "rubric",
  source: "manual",
  body: "# pr-quality-rubric\n\nRules...",
  enabled: true,
  version: 1,
  evidence_files: null,
};

describe("useSkills", () => {
  it("fetches the unfiltered catalog from GET /skills", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([SKILL]));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSkills(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([SKILL]);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:3001/skills");
  });

  it("serializes type/source/enabled filters into the querystring", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    renderHook(() => useSkills({ type: "rubric", source: "manual", enabled: true }), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/skills?");
    expect(url).toContain("type=rubric");
    expect(url).toContain("source=manual");
    expect(url).toContain("enabled=true");
  });
});

describe("useSkill", () => {
  it("stays disabled without an id", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSkill(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches GET /skills/:id when an id is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SKILL));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSkill("sk1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(SKILL);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/skills/sk1",
      expect.objectContaining({}),
    );
  });
});

describe("useCreateSkill", () => {
  it("POSTs to /skills and invalidates the catalog list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SKILL, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useCreateSkill(), { wrapper });
    result.current.mutate({ name: "x", type: "custom", body: "body" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skills"] });
  });
});

describe("useUpdateSkill", () => {
  it("PUTs to /skills/:id and invalidates the list, the skill, and its versions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SKILL));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const setSpy = vi.spyOn(qc, "setQueryData");

    const { result } = renderHook(() => useUpdateSkill(), { wrapper });
    result.current.mutate({ id: "sk1", patch: { body: "new body", summary: "Tightened rule" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/skills/sk1");
    expect(init.method).toBe("PUT");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skills"] });
    expect(setSpy).toHaveBeenCalledWith(["skill", SKILL.id], SKILL);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skill-versions", SKILL.id] });
  });
});

describe("useDeleteSkill", () => {
  it("DELETEs /skills/:id, invalidates the list, and drops cached skill/version entries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const removeSpy = vi.spyOn(qc, "removeQueries");

    const { result } = renderHook(() => useDeleteSkill(), { wrapper });
    result.current.mutate("sk1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/skills/sk1");
    expect(init.method).toBe("DELETE");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skills"] });
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ["skill", "sk1"] });
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ["skill-versions", "sk1"] });
  });
});

describe("useSkillVersions / useRestoreSkillVersion", () => {
  const V1: SkillVersion = { skill_id: "sk1", version: 1, body: "old", summary: "Initial version", created_at: "2026-01-01T00:00:00Z" };

  it("fetches version history newest-first as returned by the server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([V1]));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSkillVersions("sk1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([V1]);
  });

  it("restores a version and invalidates list/skill/versions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SKILL));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useRestoreSkillVersion(), { wrapper });
    result.current.mutate({ skillId: "sk1", version: 1 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/skills/sk1/versions/1/restore");
    expect(init.method).toBe("POST");
    // No summary override → body-less call (server defaults it).
    expect(init.body).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skills"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skill-versions", SKILL.id] });
  });
});

describe("import: file upload (multipart, bypasses the JSON api wrapper)", () => {
  it("useImportFilePreview sends a real multipart FormData body, not JSON", async () => {
    const preview = { name: "x", description: "", type: "custom", body: "# x", ignored_files: [], evidence_files: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(preview));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useImportFilePreview(), { wrapper });
    const file = new File(["# x\nbody"], "skill.md", { type: "text/markdown" });
    result.current.mutate(file);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/skills/import/file/preview");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    // Must NOT force a JSON content-type — that would break the multipart boundary.
    expect(init.headers).toBeUndefined();
    expect(result.current.data).toEqual(preview);
  });

  it("useImportFileConfirm POSTs the (possibly edited) preview as JSON and invalidates the list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SKILL, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useImportFileConfirm(), { wrapper });
    result.current.mutate({ name: "x", description: "", type: "custom", body: "# x", ignored_files: [], evidence_files: [] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/skills/import/file/confirm");
    expect(init.method).toBe("POST");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skills"] });
  });
});

describe("import: URL", () => {
  it("useImportUrlPreview POSTs { url } to the preview endpoint", async () => {
    const preview = { name: "y", description: "", type: "custom", body: "# y", ignored_files: [], evidence_files: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(preview));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useImportUrlPreview(), { wrapper });
    result.current.mutate("https://example.com/skill.md");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/skills/import/url/preview");
    expect(JSON.parse(init.body as string)).toEqual({ url: "https://example.com/skill.md" });
  });

  it("useImportUrlConfirm invalidates the catalog list on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SKILL, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useImportUrlConfirm(), { wrapper });
    result.current.mutate({ name: "y", description: "", type: "custom", body: "# y", ignored_files: [], evidence_files: [] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skills"] });
  });
});

describe("import: community", () => {
  const COMMUNITY: CommunitySkill[] = [
    { name: "owasp-top-10-review", repo: "secdev/agent-skills", stars: 1240, lang: "any", desc: "Maps diffs to OWASP Top 10." },
  ];

  it("useCommunitySkills fetches the static curated seed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(COMMUNITY));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useCommunitySkills(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(COMMUNITY);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/skills/community",
      expect.anything(),
    );
  });

  it("useInstallCommunitySkill imports by name and invalidates the catalog list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SKILL, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useInstallCommunitySkill(), { wrapper });
    result.current.mutate("owasp-top-10-review");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/skills/community/owasp-top-10-review/import");
    expect(init.method).toBe("POST");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skills"] });
  });
});
