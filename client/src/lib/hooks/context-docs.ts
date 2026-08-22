/* hooks/context-docs.ts — React Query hooks for the Project Context Folder
   feature: the repo-scoped Project Context page (discovery/reindex/preview/
   search-root config) and the Agent/Skill Editor Context tabs (attach/
   enable/reorder). One hook per endpoint, mirroring `lib/hooks/agents.ts`'s
   Skills-tab hooks (checkbox-attach + drag-reorder shape) and
   `lib/hooks/conventions.ts`'s repo-scoped hooks. Endpoint shapes per
   specs/cross-cutting/project-context-folder/spec.md §10; row-level
   contracts (`ContextDocument`, `AgentContextDocLink`/`SkillContextDocLink`,
   `ContextSearchConfig`) already live in `@devdigest/shared`
   (`src/vendor/shared/contracts/context.ts`) — the two list-endpoint
   envelopes below (`ContextDocsResponse`, `ContextDocPreview`) are NOT in
   §10's shared-contract set (only row shapes are), so they're defined here
   locally, the same way `hooks/skills.ts`'s `ImportPreview` extends a shared
   type with an endpoint-local shape rather than editing the shared barrel
   for a list-envelope-only type.

   The 3 agent-scoped and 3 skill-scoped routes below all require a
   `?repo_id=<uuid>` query param — `agents`/`skills` are workspace-scoped
   but `agent_context_docs`/`skill_context_docs` rows are additionally keyed
   by repo (spec §4's "active repo" assumption), and the server's actual
   routes (server/src/modules/{agents,skills}/routes.ts) 422 without it.
   Neither the plan nor spec §10 named this param explicitly; it was decided
   independently by both backend work items during implementation. Every
   caller must pass the currently active repo's id (`useActiveRepo()`). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentContextDocLink,
  ContextDocument,
  ContextSearchConfig,
  SkillContextDocLink,
} from "@devdigest/shared";

// ---- shared response envelopes (see spec §10; not part of the shared
// per-row contracts, so kept local to this hook file) ----

export interface ContextDocsResponse {
  documents: ContextDocument[];
  index_status: "indexed" | "not_indexed" | "disabled" | "misconfigured";
  file_count: number;
  total_chunk_count: number | null;
  last_indexed_at: string | null;
  /** AC-15 coverage indicator: % of discovered documents attached (enabled)
     to at least one agent or skill. Server-computed, not part of spec §10's
     literal table but present on every actual response — see
     server/src/modules/context-docs/service.ts. */
  coverage_percent: number;
}

export interface ContextDocPreview {
  path: string;
  content: string;
}

// ---- Project Context page · repo-scoped discovery/reindex/preview/config ----

/** Discovered documents for the repo's Project Context page — grouped by
   `root` client-side, coverage computed from `used_by_agents`/
   `used_by_skills`. `clonePath`-null / never-indexed repos return the
   `"not_indexed"` empty state, not a 404/500 (AC-16). */
export function useContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-docs", repoId],
    queryFn: () => api.get<ContextDocsResponse>(`/repos/${repoId}/context-docs`),
    enabled: !!repoId,
  });
}

/** Triggers a fresh scan against the repo's configured (or default)
   search-root globs; response is the same envelope as `useContextDocs`, so
   a success seeds that query's cache directly instead of a bare
   invalidate+refetch. */
export function useReindexContextDocs(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ContextDocsResponse>(`/repos/${repoId}/context-docs/reindex`),
    onSuccess: (data) => {
      qc.setQueryData(["context-docs", repoId], data);
    },
  });
}

/** Read-only file content for the Preview pane — no edit/save endpoint
   exists (AC-14). `404` for a path no longer in the latest scan. */
export function useContextDocPreview(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["context-doc-preview", repoId, path],
    queryFn: () =>
      api.get<ContextDocPreview>(
        `/repos/${repoId}/context-docs/preview?path=${encodeURIComponent(path!)}`,
      ),
    enabled: !!repoId && !!path,
  });
}

/** Per-repo search-root exclude-pattern config; unset repos fall back to the
   server's default excludes. */
export function useContextConfig(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-config", repoId],
    queryFn: () => api.get<ContextSearchConfig>(`/repos/${repoId}/context-config`),
    enabled: !!repoId,
  });
}

/** Persists the search-root exclude patterns (`422` on an empty/whitespace-
   only pattern, AC-7); takes effect on the next reindex, not retroactively —
   callers don't need to invalidate `context-docs` here. */
export function useSetContextConfig(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (excludes: string[]) =>
      api.put<ContextSearchConfig>(`/repos/${repoId}/context-config`, { excludes }),
    onSuccess: (data) => {
      qc.setQueryData(["context-config", repoId], data);
    },
  });
}

// ---- Agent Editor · Context tab (mirrors hooks/agents.ts's Skills-tab shape) ----

/** This agent's current context-doc links, ordered ascending by `order` —
   the Context tab merges this with `useContextDocs()`'s full repo catalog
   (linked first in their order, unlinked appended after). `document: null`
   flags a path no longer in the latest scan (AC-22). */
export function useAgentContextDocs(
  agentId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["agent-context-docs", agentId, repoId],
    queryFn: () =>
      api.get<AgentContextDocLink[]>(
        `/agents/${agentId}/context-docs?repo_id=${repoId}`,
      ),
    enabled: !!agentId && !!repoId,
  });
}

/** Full-replace reorder: POST the whole desired ordered path list (attached
   AND unattached) — mirrors `useSetAgentSkills`'s bulk semantics exactly,
   including that a brand-new path defaults to `enabled: false` (only the
   PATCH toggle attaches AND enables in one call — see
   `server/INSIGHTS.md`'s `agent_skills` bulk-POST-vs-PATCH gotcha, which
   `agent_context_docs` deliberately replicates). */
export function useSetAgentContextDocs(
  agentId: string | null | undefined,
  repoId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.post<AgentContextDocLink[]>(
        `/agents/${agentId}/context-docs?repo_id=${repoId}`,
        { paths },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-context-docs", agentId, repoId] });
    },
  });
}

/** The Context tab row checkbox: checking a not-yet-linked document both
   creates the link AND sets `enabled: true` in one call; unchecking a
   linked one flips `enabled: false` without dropping its `order`. */
export function useSetAgentContextDocEnabled(
  agentId: string | null | undefined,
  repoId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, enabled }: { path: string; enabled: boolean }) =>
      api.patch<AgentContextDocLink[]>(
        `/agents/${agentId}/context-docs/${encodeURIComponent(path)}?repo_id=${repoId}`,
        { enabled },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-context-docs", agentId, repoId] });
    },
  });
}

// ---- Skill Editor · Context tab (identical shape, skill-scoped) ----

/** This skill's current context-doc links, ordered ascending by `order`. */
export function useSkillContextDocs(
  skillId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["skill-context-docs", skillId, repoId],
    queryFn: () =>
      api.get<SkillContextDocLink[]>(
        `/skills/${skillId}/context-docs?repo_id=${repoId}`,
      ),
    enabled: !!skillId && !!repoId,
  });
}

/** Full-replace reorder — skill-scoped equivalent of `useSetAgentContextDocs`. */
export function useSetSkillContextDocs(
  skillId: string | null | undefined,
  repoId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.post<SkillContextDocLink[]>(
        `/skills/${skillId}/context-docs?repo_id=${repoId}`,
        { paths },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-context-docs", skillId, repoId] });
    },
  });
}

/** Row checkbox toggle — skill-scoped equivalent of `useSetAgentContextDocEnabled`. */
export function useSetSkillContextDocEnabled(
  skillId: string | null | undefined,
  repoId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, enabled }: { path: string; enabled: boolean }) =>
      api.patch<SkillContextDocLink[]>(
        `/skills/${skillId}/context-docs/${encodeURIComponent(path)}?repo_id=${repoId}`,
        { enabled },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-context-docs", skillId, repoId] });
    },
  });
}
