import type { ContextDocIndexStatus, ContextDocRoot } from "@devdigest/shared";

/** Discovery order for grouping the Project Context page's document list —
   matches the default search-root glob's own ordering (specs, docs, insights;
   spec §2/§9). */
export const ROOT_ORDER: ContextDocRoot[] = ["specs", "docs", "insights"];

export const ROOT_LABEL: Record<ContextDocRoot, string> = {
  specs: "Specs",
  docs: "Docs",
  insights: "Insights",
};

/** Per-document degraded-indexing labels shown instead of a chunk count
   (AC-9/AC-10/AC-11) — `"indexed"` isn't listed here since that case shows
   the real `chunk_count` number instead of a label. */
export const DEGRADED_STATUS_LABEL: Partial<Record<ContextDocIndexStatus, string>> = {
  disabled: "Indexing disabled",
  misconfigured: "Indexing misconfigured",
  too_large_to_index: "Too large to index",
};

export const SKELETON_ROWS = 4;
