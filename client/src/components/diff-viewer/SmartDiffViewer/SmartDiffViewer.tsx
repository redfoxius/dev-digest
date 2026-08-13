/* SmartDiffViewer — grouped-by-risk diff (core/wiring/boilerplate), a sibling
   to the flat DiffViewer (not a replacement — DiffTab's "Original order"
   toggle still needs the flat view). Renders `SmartDiff.groups[]` in the
   order the server already returns them, reusing FileCard for each file's
   collapsible patch view.

   Not in this phase: rendering `pseudocode_summary` (Phase 5) or any
   `split_suggestion` UI (Phase 6) — the server always returns `null`/`[]`
   for those fields until then. */
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

  return (
    <div style={s.list}>
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
                  return (
                    <FileCard
                      key={file.path}
                      file={prFile}
                      commenting={commenting}
                      defaultOpen={defaultOpen}
                      scrollToLine={scrollToLine}
                      findingSeverityByLine={findingSeverityByLine}
                      headerRight={findingsChip || undefined}
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
