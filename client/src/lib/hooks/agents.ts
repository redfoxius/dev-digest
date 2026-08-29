/* hooks/agents.ts — React Query hooks for the A2 Agents tab + Agent Editor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Agent, AgentSkillLink, AgentVersion, ModelInfo, Provider, ReviewStrategy } from "@devdigest/shared";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<Agent[]>("/agents"),
  });
}

export function useAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.get<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  enabled?: boolean;
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => api.post<Agent>("/agents", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export interface UpdateAgentInput {
  id: string;
  patch: Partial<
    Pick<
      Agent,
      | "name"
      | "description"
      | "provider"
      | "model"
      | "system_prompt"
      | "output_schema"
      | "strategy"
      | "ci_fail_on"
      | "repo_intel"
      | "enabled"
    >
  >;
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentInput) => api.put<Agent>(`/agents/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/agents/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.removeQueries({ queryKey: ["agent", id] });
    },
  });
}

// ---- Agent version history (Eval Dashboard Compare-runs view, AC-22/AC-26/AC-27) ----

/** Every immutable config snapshot for this agent, DESC by `version`
   (`AgentsRepository.listVersions`, `GET /agents/:id/versions`) — the source
   list `resolveAgentVersionForBatch` (`CompareRunsModal/helpers.ts`) resolves
   a batch's live version against. */
export function useAgentVersions(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-versions", agentId],
    queryFn: () => api.get<AgentVersion[]>(`/agents/${agentId}/versions`),
    enabled: !!agentId,
  });
}

/** One resolved version's full snapshot (incl. `config.system_prompt`),
   `GET /agents/:id/versions/:version` — fetched only once a version number
   has been resolved client-side, hence the extra `version != null` gate. */
export function useAgentVersion(agentId: string | null | undefined, version: number | null | undefined) {
  return useQuery({
    queryKey: ["agent-version", agentId, version],
    queryFn: () => api.get<AgentVersion>(`/agents/${agentId}/versions/${version}`),
    enabled: !!agentId && version != null,
  });
}

/** Dynamic model list for a provider (editor model picker). */
export function useProviderModels(provider: Provider | null | undefined) {
  return useQuery({
    queryKey: ["provider-models", provider],
    queryFn: () => api.get<ModelInfo[]>(`/providers/${provider}/models`),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

// ---- Agent Editor · Skills tab (unified catalog list, checkbox-attach + drag-reorder) ----

/** This agent's current skill links, ordered ascending by `order` — the
   Skills-tab merges this with `useSkills()`'s full workspace catalog
   (linked first in their order, unlinked appended after). */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/** Full-replace reorder: POST the WHOLE catalog's ids (linked + unlinked) in
   the desired order — lets a drag reposition an unchecked row too. Also
   affects `Agent.skills_count`, so the agents list is invalidated alongside
   this agent's own link list. */
export function useSetAgentSkills(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillIds: string[]) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

/** The Skills-tab row checkbox: checking a not-yet-linked skill both creates
   the link AND sets `enabled: true` in one call (server-side upsert);
   unchecking a linked one flips `enabled: false` without dropping its
   `order`. Changes `skills_count` too, so the agents list is invalidated
   alongside this agent's own link list. */
export function useSetAgentSkillEnabled(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, enabled }: { skillId: string; enabled: boolean }) =>
      api.patch<AgentSkillLink[]>(`/agents/${agentId}/skills/${skillId}`, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
