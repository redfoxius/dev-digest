import type { ContextDocument, SkillContextDocLink } from "@devdigest/shared";
import { PROJECT_CONTEXT_BODY_PLACEHOLDER, PROJECT_CONTEXT_HEADING } from "./constants";

/** One row of the unified Context-tab list: every discovered document for
   the active repo, paired with this skill's link row when one exists.
   `link` is undefined for a document never attached to this skill.
   `document` comes straight from the link's own resolved `document` field
   for an attached row (server-computed, AC-22: `null` when the path no
   longer resolves in the latest scan) — never re-derived from the repo's
   full catalog, so a not-yet-loaded/stale catalog can't mask a real
   "missing" attachment. */
export interface ContextDocRow {
  path: string;
  document?: ContextDocument | null;
  link?: SkillContextDocLink;
}

/** Merges the repo's full discovered-document catalog with this skill's
   current links into ONE ordered list: attached documents first (ascending
   by their existing `order`), then unattached catalog documents appended
   after, stable by path. Mirrors `SkillsTab`'s `mergeSkills` shape, keyed by
   `path` instead of `skill.id` since documents have no stable id contract
   here (attachment is path-based, per spec §4). */
export function mergeContextDocs(
  documents: ContextDocument[] | undefined,
  links: SkillContextDocLink[] | undefined,
): ContextDocRow[] {
  const sortedLinks = (links ?? []).slice().sort((a, b) => a.order - b.order);
  const linkedPaths = new Set(sortedLinks.map((link) => link.path));

  const linkedRows: ContextDocRow[] = sortedLinks.map((link) => ({
    path: link.path,
    document: link.document,
    link,
  }));

  const unlinkedRows: ContextDocRow[] = (documents ?? [])
    .filter((doc) => !linkedPaths.has(doc.path))
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((document) => ({ path: document.path, document }));

  return [...linkedRows, ...unlinkedRows];
}

/** Case-insensitive substring match over the document's path, for the
   "Filter documents…" input. Empty/whitespace filter matches everything. */
export function matchesContextDocFilter(row: ContextDocRow, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return row.path.toLowerCase().includes(needle);
}

/** Moves the row identified by `dragPath` to sit at the position currently
   occupied by `targetPath`, preserving every other row's relative order.
   Returns `rows` unchanged if either path can't be found or they're equal. */
export function reorderContextDocRows(
  rows: ContextDocRow[],
  dragPath: string,
  targetPath: string,
): ContextDocRow[] {
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

/** Mirrors `reviewer-core`'s `wrapUntrusted(label, content)`
   (`reviewer-core/src/prompt.ts:30-34`) for preview purposes only: same
   `<untrusted source="...">\n{content}\n</untrusted>` shape. Skips that
   function's `</untrusted>`-escaping — a placeholder body (see
   `PROJECT_CONTEXT_BODY_PLACEHOLDER`) can never contain a real closing
   delimiter, so there's nothing to escape here. */
function wrapUntrustedPreview(label: string, content: string): string {
  return `<untrusted source="${label}">\n${content}\n</untrusted>`;
}

/** Builds the literal text the "SERIALIZES AS" panel shows for this skill's
   currently-enabled attached document paths, in their configured order.
   This is a CLIENT-SIDE RE-DERIVATION of the run-executor's real injection
   shape: `## Project context\n${specs.map((s,i) => wrapUntrusted(`spec-${i}`,
   s)).join('\n\n')}` (`reviewer-core/src/prompt.ts:158,132`), where each
   `s` is `### {path}\n\n{body}` (`server/src/modules/context-docs/
   resolve.ts`). Not a shared function, since `reviewer-core` is a
   server-only TS path alias the client cannot import.

   JUDGMENT CALL on body text: fetching every enabled document's real
   content on every keystroke/toggle would mean N extra requests per
   render of this panel, so real body text is NOT fetched here. Instead
   `PROJECT_CONTEXT_BODY_PLACEHOLDER` stands in for it, so the STRUCTURAL
   shape the panel shows — heading, `spec-{i}`-labeled `<untrusted>`
   wrapper (same index-based labels and skill-configured order the
   run-executor would actually resolve), `### {path}` prefix, then a body
   before the matching close — is complete and accurate, even though the
   body's literal characters aren't. Returns `""` when no document is
   enabled (panel shows an empty-state message instead). */
export function serializeProjectContextPreview(enabledPaths: string[]): string {
  if (enabledPaths.length === 0) return "";
  const specsBlock = enabledPaths
    .map((path, i) =>
      wrapUntrustedPreview(`spec-${i}`, `### ${path}\n\n${PROJECT_CONTEXT_BODY_PLACEHOLDER}`),
    )
    .join("\n\n");
  return `${PROJECT_CONTEXT_HEADING}\n${specsBlock}`;
}
