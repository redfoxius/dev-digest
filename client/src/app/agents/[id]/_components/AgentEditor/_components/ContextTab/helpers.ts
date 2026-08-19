import type { AgentContextDocLink, ContextDocument } from "@devdigest/shared";
import { CHARS_PER_TOKEN } from "./constants";

/** One row of the unified Context-tab list: either an attached document
   (`link` defined — its `document` may be `null` when the path is missing
   from the latest `context_documents` scan, AC-22) or a discovered-but-
   unattached document (`link` undefined, `document` always present since it
   came straight from the repo catalog). */
export interface ContextDocRow {
  path: string;
  document: ContextDocument | null;
  link?: AgentContextDocLink;
}

/** Merges the repo's full discovered-document catalog with this agent's
   current context-doc links into ONE ordered list: attached documents
   first (ascending by their existing `order`), then unattached documents
   appended after, stable by path. Mirrors SkillsTab's `mergeSkills` shape,
   keyed by `path` instead of a skill id. */
export function mergeContextDocs(
  documents: ContextDocument[] | undefined,
  links: AgentContextDocLink[] | undefined,
): ContextDocRow[] {
  const sortedLinks = (links ?? []).slice().sort((a, b) => a.order - b.order);
  const attachedPaths = new Set(sortedLinks.map((link) => link.path));

  const attachedRows: ContextDocRow[] = sortedLinks.map((link) => ({
    path: link.path,
    document: link.document,
    link,
  }));

  const unattachedRows: ContextDocRow[] = (documents ?? [])
    .filter((doc) => !attachedPaths.has(doc.path))
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((document) => ({ path: document.path, document }));

  return [...attachedRows, ...unattachedRows];
}

/** Case-insensitive substring match over the document's path, for the
   "Filter documents…" input. Empty/whitespace filter matches everything. */
export function matchesContextFilter(row: ContextDocRow, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return row.path.toLowerCase().includes(needle);
}

/** Moves the row identified by `dragPath` to sit at the position currently
   occupied by `targetPath`, preserving every other row's relative order.
   Returns `rows` unchanged if either path can't be found or they're equal. */
export function reorderContextRows(rows: ContextDocRow[], dragPath: string, targetPath: string): ContextDocRow[] {
  if (dragPath === targetPath) return rows;
  const dragIndex = rows.findIndex((r) => r.path === dragPath);
  const targetIndex = rows.findIndex((r) => r.path === targetPath);
  if (dragIndex === -1 || targetIndex === -1) return rows;

  const next = rows.slice();
  const [dragged] = next.splice(dragIndex, 1);
  const insertAt = next.findIndex((r) => r.path === targetPath);
  next.splice(insertAt === -1 ? targetIndex : insertAt, 0, dragged!);
  return next;
}

/** Ballpark token count for the footer's live "≈ N tokens" estimate —
   chars / CHARS_PER_TOKEN, the exact heuristic duplicated from ConfigTab's
   `estimateTokens` (AC-21). Takes a raw character count rather than a body
   string since callers sum `size_bytes` across multiple documents as a
   length proxy (see `estimateAttachedTokens`) instead of fetching every
   attached document's full content. */
export function estimateTokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN);
}

/** Aggregate "≈ N tokens" estimate for the agent's currently ENABLED
   attached documents only (AC-21) — sums `size_bytes` (a length proxy) over
   rows that are both linked+enabled and have a resolvable `document`; a
   `document: null` (missing/deleted file, AC-22) row contributes nothing
   since its size can no longer be read. */
export function estimateAttachedTokens(rows: ContextDocRow[]): number {
  const totalChars = rows
    .filter((row) => row.link?.enabled && row.document)
    .reduce((sum, row) => sum + (row.document?.size_bytes ?? 0), 0);
  return estimateTokens(totalChars);
}
