/* hooks/skills.ts — React Query hooks for the A1 Skills module: the
   standalone /skills master-detail page (Config/Preview/Versions tabs) and
   the import pipeline (paste/file+archive upload/URL/community). One hook
   per `server/src/modules/skills/routes.ts` endpoint — see
   docs/skills-feature-plan.md's "Server: new skills module" route list.
   Agent-side skill links (attach/enable/reorder) live in hooks/agents.ts,
   not here — this file only owns the skill's own CRUD/import lifecycle. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE, ApiError } from "../api";
import type {
  CommunitySkill,
  CreateSkillBody,
  ImportCandidate,
  Skill,
  SkillSource,
  SkillStats,
  SkillType,
  SkillVersion,
  UpdateSkillBody,
} from "@devdigest/shared";

// ---- list / get -----------------------------------------------------------

export interface ListSkillsFilters {
  type?: SkillType;
  source?: SkillSource;
  enabled?: boolean;
}

function skillsQueryString(filters?: ListSkillsFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.type !== undefined) params.set("type", filters.type);
  if (filters.source !== undefined) params.set("source", filters.source);
  if (filters.enabled !== undefined) params.set("enabled", String(filters.enabled));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Workspace-scoped skill catalog, optionally filtered by type/source/enabled
   (matches `GET /skills`'s querystring). Powers the standalone Skills page's
   list AND the Agent Editor's Skills-tab unified catalog. */
export function useSkills(filters?: ListSkillsFilters) {
  return useQuery({
    queryKey: ["skills", filters ?? {}],
    queryFn: () => api.get<Skill[]>(`/skills${skillsQueryString(filters)}`),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

// ---- create / update / delete ---------------------------------------------

/** Direct create (`source: 'manual'`, `enabled: true`) — both the "+ New
   skill" blank-create form and the "From file" tab's paste sub-form call
   this (paste's name+body IS the final content, no preview/confirm step). */
export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillBody) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: UpdateSkillBody;
}

/** Config-tab Save. A real name/description/type/body change bumps the
   skill's version server-side (snapshotting `skill_versions`) — `enabled`
   alone does not. Invalidates the catalog list, this skill's own query, AND
   its version history (a new version may have just been created). */
export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
      qc.removeQueries({ queryKey: ["skill-versions", id] });
    },
  });
}

// ---- versions ---------------------------------------------------------

/** Version history, newest first — each row already carries its own `body`,
   so the Versions tab's client-side Diff action needs no extra fetch per
   version. */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export interface RestoreSkillVersionInput {
  skillId: string;
  version: number;
  /** Optional override for the new snapshot's summary; server defaults to
     `"Restored from v{n}"` when omitted. */
  summary?: string;
}

/** Restore never rewrites history in place — it creates a NEW version whose
   body matches the target version's. Invalidates the same three cache
   entries as `useUpdateSkill` (list/skill/versions all changed). */
export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, version, summary }: RestoreSkillVersionInput) =>
      api.post<Skill>(
        `/skills/${skillId}/versions/${version}/restore`,
        summary ? { summary } : undefined,
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

// ---- stats --------------------------------------------------------------

/** Stats tab: used_by/agents_using_this_skill (live snapshot) plus
   pull-frequency/accept-rate/findings-by-category over a rolling `days`
   window (default 30, matches the server's default). Skills with no runs
   yet return zeros/nulls, not an error — see
   docs/skills-feature-plan.md#stats-tab--addendum. */
export function useSkillStats(id: string | null | undefined, days?: number) {
  return useQuery({
    queryKey: ["skill-stats", id, days ?? 30],
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats?days=${days ?? 30}`),
    enabled: !!id,
  });
}

// ---- import: file / archive upload -----------------------------------------

/** What a file/URL/community import extracts BEFORE persisting — the
   editable preview shown in the drawer, then round-tripped to a "confirm"
   endpoint. `evidence_files` (other markdown files found alongside the main
   one) isn't part of the shared `ImportCandidate` contract — it's extraction
   -only, added here the same way `server/src/modules/skills/service.ts`
   keeps its own module-local `ImportPreview` type. */
export type ImportPreview = ImportCandidate & { evidence_files: string[] };

/**
 * `POST /skills/import/file/preview` is the one skills endpoint that isn't
 * plain JSON — it's a multipart file upload, so it can't go through
 * `api.post` (which always JSON-stringifies the body and forces a JSON
 * content-type, which would break the multipart boundary header). Mirrors
 * `apiFetch`'s error-normalization so callers still get a consistent
 * `ApiError`; see `hooks/reviews.ts`'s `useRunEvents` for the precedent of a
 * hook reaching for `API_BASE` directly when the shared wrapper doesn't fit.
 */
async function postSkillFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file, file.name);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: "POST", body: form });
  } catch (e) {
    throw new ApiError(
      `Cannot reach the DevDigest engine at ${API_BASE}. Is the API running?`,
      0,
      "network_error",
      e,
    );
  }

  if (!res.ok) {
    let code: string | undefined;
    let message = `${res.status} ${res.statusText}`;
    let details: unknown;
    try {
      const body = await res.json();
      if (body?.error) {
        code = body.error.code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, code, details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Upload a `.md`/`.markdown` file or a `.zip`/`.tar`/`.tar.gz` archive →
   an extracted preview (never persisted, never executes archive contents —
   non-markdown entries only ever surface as `ignored_files`). No cache
   invalidation — a preview doesn't change any persisted state. */
export function useImportFilePreview() {
  return useMutation({
    mutationFn: (file: File) => postSkillFile<ImportPreview>("/skills/import/file/preview", file),
  });
}

/** Persist a (possibly user-edited) file/archive preview — `source:
   'manual'`, `enabled: true` (a human provided it to the app directly). */
export function useImportFileConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (candidate: ImportPreview) => api.post<Skill>("/skills/import/file/confirm", candidate),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

// ---- import: URL --------------------------------------------------------

/** Fetch a URL server-side and extract it the same way as a file upload. */
export function useImportUrlPreview() {
  return useMutation({
    mutationFn: (url: string) => api.post<ImportPreview>("/skills/import/url/preview", { url }),
  });
}

/** Persist a URL-import preview — `source: 'imported_url'`, `enabled: false`
   (fetched without a human in the loop; needs vetting before it can inject
   into a prompt). */
export function useImportUrlConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (candidate: ImportPreview) => api.post<Skill>("/skills/import/url/confirm", candidate),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

// ---- import: community ---------------------------------------------------

/** Static curated seed (course-scope demo, not a live registry fetch) — the
   CommunitySkillsDrawer's search/language/tag filtering happens client-side
   over this fixed list. */
export function useCommunitySkills() {
  return useQuery({
    queryKey: ["community-skills"],
    queryFn: () => api.get<CommunitySkill[]>("/skills/community"),
    staleTime: 5 * 60_000,
  });
}

/** Install a community-catalog entry by name — `source: 'community'`,
   `enabled: false` (needs vetting, same as a URL import). */
export function useInstallCommunitySkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<Skill>(`/skills/community/${name}/import`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}
