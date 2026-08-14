/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import type { ScrollTarget } from "../helpers";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  scrollTarget,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** An external "view in diff" request (Findings tab) — forwarded only to
   *  the one FileCard whose path matches; a non-matching/omitted target is a
   *  no-op for every FileCard. */
  scrollTarget?: ScrollTarget | null;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f, i) => (
        <FileCard
          key={i}
          file={f}
          commenting={commenting}
          scrollToLine={
            scrollTarget && scrollTarget.path === f.path
              ? { line: scrollTarget.line, nonce: scrollTarget.nonce }
              : undefined
          }
        />
      ))}
    </div>
  );
}
