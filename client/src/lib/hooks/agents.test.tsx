/* hooks/agents.test.tsx — smoke tests for the Agent Editor's Skills-tab
   hooks (link fetch/reorder/checkbox-toggle). Mocks `fetch` (no API/DB/
   browser needed, per client/AGENTS.md's testing convention). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AgentSkillLink } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkillEnabled, useSetAgentSkills } from "./agents";

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

const LINKS: AgentSkillLink[] = [
  { agent_id: "ag1", skill_id: "sk1", order: 0, enabled: true },
  { agent_id: "ag1", skill_id: "sk2", order: 1, enabled: false },
];

describe("useAgentSkills", () => {
  it("stays disabled without an agentId", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useAgentSkills(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches GET /agents/:id/skills, ordered as the server returns it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(LINKS));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useAgentSkills("ag1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(LINKS);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/agents/ag1/skills",
      expect.anything(),
    );
  });
});

describe("useSetAgentSkills (drag-reorder / full-replace)", () => {
  it("POSTs the full ordered skill_ids array and invalidates both this agent's links and the agents list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(LINKS));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useSetAgentSkills("ag1"), { wrapper });
    result.current.mutate(["sk2", "sk1"]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agents/ag1/skills");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ skill_ids: ["sk2", "sk1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent-skills", "ag1"] });
    // skills_count on the agents list can change from a reorder that also
    // (re)attaches a previously-unlinked row — invalidate the list too.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agents"] });
  });
});

describe("useSetAgentSkillEnabled (row checkbox)", () => {
  it("PATCHes /agents/:id/skills/:skillId with { enabled } and invalidates links + the agents list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(LINKS));
    vi.stubGlobal("fetch", fetchMock);
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useSetAgentSkillEnabled("ag1"), { wrapper });
    result.current.mutate({ skillId: "sk2", enabled: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agents/ag1/skills/sk2");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ enabled: true });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent-skills", "ag1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agents"] });
  });
});
