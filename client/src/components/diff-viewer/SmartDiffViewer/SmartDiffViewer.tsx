/* SmartDiffViewer — grouped-by-risk diff (core/wiring/boilerplate), a sibling
   to the flat DiffViewer (not a replacement — DiffTab's "Original order"
   toggle still needs the flat view). Renders `SmartDiff.groups[]` in the
   order the server already returns them, reusing FileCard for each file's
   collapsible patch view.

   Phase 5 — `pseudocode_summary` renders in TWO spots: a "Summary" Chip on
   the file's header row (visible collapsed, alongside the findings Chip in
   the same `headerRight` slot) and the "What this does: …" text block
   FileCard itself renders below its header once open.

   Phase 6 — a `split_suggestion` banner (rendered only when `too_big`),
   above the group list: one clickable Chip per `ProposedSplit`. Clicking a
   split's Chip highlights that split's files by dimming every OTHER
   rendered `FileCard` (via its new `dimmed` prop); clicking the same Chip
   again clears the highlight. Suggestion/highlight surface only — no PR is
   actually created or split here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Chip } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import type { SmartDiff, SmartDiffRole } from "@devdigest/shared";
import { type DiffCommentApi } from "../comments";
import { chevronFor } from "../styles";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { FileCard } from "../FileCard";
import { ROLE_COLORS, DEFAULT_SECTION_OPEN } from "./constants";
import { s } from "./styles";

interface ScrollTarget {
  path: string;
  line: number;
  nonce: number;
}

/** The currently-highlighted proposed split (Phase 6) — `index` (not just
 *  `files`) is tracked so clicking the SAME Chip twice can be detected and
 *  toggled off, even if two splits happened to have identical `files`. */
interface HighlightedSplit {
  index: number;
  files: string[];
}

export function SmartDiffViewer({
  smartDiff,
  files,
  commenting,
}: {
  smartDiff: SmartDiff;
  files: PrFile[];
  commenting?: DiffCommentApi;
}) {
  const t = useTranslations("prReview");
  // `SmartDiffFile` carries no `patch` — build the lookup once so each
  // classified file can hand its full row to `FileCard`.
  const fileMap = React.useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const [openSections, setOpenSections] =
    React.useState<Record<SmartDiffRole, boolean>>(DEFAULT_SECTION_OPEN);
  const [scrollTarget, setScrollTarget] = React.useState<ScrollTarget | null>(null);
  const [highlightedSplit, setHighlightedSplit] = React.useState<HighlightedSplit | null>(null);

  const { too_big: tooBig, total_lines: totalLines, proposed_splits: proposedSplits } =
    smartDiff.split_suggestion;

  return (
    <div style={s.list}>
      {tooBig && (
        <div style={s.splitBanner}>
          <div style={s.splitBannerTitle}>{t("smartDiff.largeTitle", { lines: totalLines })}</div>
          <div style={s.splitBannerBody}>{t("smartDiff.largeBody")}</div>
          <div style={s.splitChips}>
            {proposedSplits.map((split, index) => (
              <Chip
                key={`${split.name}-${index}`}
                active={highlightedSplit?.index === index}
                onClick={() =>
                  setHighlightedSplit((prev) =>
                    prev?.index === index ? null : { index, files: split.files },
                  )
                }
              >
                {split.name} · {t("smartDiff.filesCount", { count: split.files.length })}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {smartDiff.groups.map((group) => {
        const isOpen = openSections[group.role];
        return (
          <div key={group.role} style={s.section}>
            <button
              type="button"
              style={s.sectionHeader}
              aria-expanded={isOpen}
              onClick={() =>
                setOpenSections((prev) => ({ ...prev, [group.role]: !prev[group.role] }))
              }
            >
              <Icon.ChevronRight size={13} style={chevronFor(isOpen)} />
              <span
                data-role-dot={group.role}
                style={{ ...s.roleDot, backgroundColor: ROLE_COLORS[group.role] }}
              />
              <span style={s.roleTitle}>{t(`smartDiff.${group.role}Label`)}</span>
              <span style={s.roleDescription}>{t(`smartDiff.${group.role}Description`)}</span>
              <span style={s.roleFileCount}>
                {t("smartDiff.filesCount", { count: group.files.length })}
              </span>
            </button>
            {isOpen && (
              <div style={s.sectionBody}>
                {group.files.map((file) => {
                  const prFile = fileMap.get(file.path);
                  if (!prFile) return null;
                  const defaultOpen =
                    group.role !== "boilerplate" &&
                    (file.findings_count > 0 ||
                      file.additions + file.deletions <= AUTO_EXPAND_MAX_LINES);
                  const findingSeverityByLine = new Map(
                    file.finding_lines.map((f) => [f.line, f.severity]),
                  );
                  const scrollToLine =
                    scrollTarget && scrollTarget.path === file.path
                      ? { line: scrollTarget.line, nonce: scrollTarget.nonce }
                      : undefined;
                  const findingsChip = file.findings_count > 0 && (
                    <Chip
                      onClick={() =>
                        setScrollTarget((prev) => ({
                          path: file.path,
                          line: file.finding_lines[0]!.line,
                          nonce: (prev?.nonce ?? 0) + 1,
                        }))
                      }
                    >
                      {t("verdict.findingsCount", { count: file.findings_count })}
                    </Chip>
                  );
                  const summaryChip = file.pseudocode_summary != null && (
                    <Chip icon="Info">{t("smartDiff.summaryLabel")}</Chip>
                  );
                  const headerRight = (findingsChip || summaryChip) && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {findingsChip}
                      {summaryChip}
                    </span>
                  );
                  const dimmed =
                    highlightedSplit != null && !highlightedSplit.files.includes(file.path);
                  return (
                    <FileCard
                      key={file.path}
                      file={prFile}
                      commenting={commenting}
                      defaultOpen={defaultOpen}
                      scrollToLine={scrollToLine}
                      findingSeverityByLine={findingSeverityByLine}
                      headerRight={headerRight || undefined}
                      pseudocodeSummary={file.pseudocode_summary}
                      dimmed={dimmed}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
