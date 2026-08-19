import type { ContextDocument, ContextDocRoot } from "@devdigest/shared";
import { DEGRADED_STATUS_LABEL, ROOT_ORDER } from "./constants";

/** Groups discovered documents by their `root` classification, preserving
   `ROOT_ORDER` as the group iteration order regardless of API response
   order (AC-13). Empty groups are omitted by the caller, not here — this
   just partitions. */
export function groupByRoot(
  documents: ContextDocument[],
): Record<ContextDocRoot, ContextDocument[]> {
  const groups = Object.fromEntries(ROOT_ORDER.map((root) => [root, [] as ContextDocument[]])) as Record<
    ContextDocRoot,
    ContextDocument[]
  >;
  for (const doc of documents) {
    (groups[doc.root] ?? (groups[doc.root] = [])).push(doc);
  }
  return groups;
}

/** Compact relative time for the "last refreshed" status line — mirrors
   `repos/[repoId]/pulls/helpers.ts`'s `relativeTime`, this route's own
   copy since the two features share no other logic (see
   client/INSIGHTS.md's "promote after a 4th consumer" convention). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "never";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** A document's chunk-count cell: the real number when indexed, or a
   degraded-status label in its place (AC-9/AC-10/AC-11) — never both. */
export function chunkCountLabel(doc: ContextDocument): { count: number } | { label: string } {
  if (doc.chunk_count != null) return { count: doc.chunk_count };
  return { label: DEGRADED_STATUS_LABEL[doc.index_status] ?? "Not indexed" };
}
