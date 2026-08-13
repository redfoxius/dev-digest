/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import type { Severity } from "@devdigest/shared";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  defaultOpen,
  scrollToLine,
  findingSeverityByLine,
  headerRight,
  pseudocodeSummary,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Overrides the default size-based auto-expand calculation (Smart Diff). */
  defaultOpen?: boolean;
  /** Forces the card open and smooth-scrolls to `[data-line=line]`; bump
   *  `nonce` to re-fire the same scroll (e.g. clicking the same badge twice). */
  scrollToLine?: { line: number; nonce: number };
  /** Per-line severity (Smart Diff's finding_lines), passed through to each
   *  rendered `CodeLine` by its `newNo`. */
  findingSeverityByLine?: Map<number, Severity>;
  /** Extra content appended to the header row (e.g. Smart Diff's "N findings"
   *  Chip) — click events inside it are stopped from bubbling to the header's
   *  own open/close toggle. */
  headerRight?: React.ReactNode;
  /** Smart Diff's per-file "what this does" one-liner (Phase 5) — rendered
   *  as a text block right below the header, only while the card is open.
   *  Additive/no-op when omitted, same as this component's other Smart-Diff
   *  props. */
  pseudocodeSummary?: string | null;
}) {
  const t = useTranslations("shell");
  const tPrReview = useTranslations("prReview");
  const [open, setOpen] = React.useState(
    defaultOpen ?? (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // A new scroll target (nonce bump) always forces this card open first...
  React.useEffect(() => {
    if (scrollToLine) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToLine?.nonce]);

  // ...then, once open (lines are in the DOM), scroll the target line into view.
  // Depends on `open` too so a close→reopen via this same nonce still scrolls
  // once the DOM actually has the line, not on the same tick `setOpen` fires.
  React.useEffect(() => {
    if (!scrollToLine) return;
    const el = containerRef.current?.querySelector(`[data-line="${scrollToLine.line}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToLine?.nonce, open]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard} ref={containerRef} data-file={file.path}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
        {headerRight && (
          <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
            {headerRight}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {pseudocodeSummary != null && (
            <div style={s.pseudocodeSummary}>
              <strong>{tPrReview("smartDiff.whatThisDoes")}</strong> {pseudocodeSummary}
            </div>
          )}
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                findingSeverity={ln.newNo != null ? findingSeverityByLine?.get(ln.newNo) : undefined}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
