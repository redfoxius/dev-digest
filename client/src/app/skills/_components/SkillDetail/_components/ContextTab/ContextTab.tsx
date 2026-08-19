/* ContextTab — Skill Editor's "Project context to use" list. One row per
   document discovered for the active repo (attached ones first, in order);
   a Checkbox both attaches and toggles injection, drag reorders the FULL
   list (checked + unchecked) via `useSetSkillContextDocs`. Structurally
   mirrors the Agent Editor's `SkillsTab.tsx` (checkbox/drag-reorder/
   aria-live pattern) and Work Item 14's identically-shaped agent-scoped
   Context tab — this is an independent, skill-scoped copy, not a shared
   import (see specs/cross-cutting/project-context-folder/spec.md §6.6). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, ErrorState, Icon, Badge, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import {
  useContextDocs,
  useSetSkillContextDocEnabled,
  useSetSkillContextDocs,
  useSkillContextDocs,
} from "../../../../../../lib/hooks/context-docs";
import { useActiveRepo } from "../../../../../../lib/repo-context";
import { CONTEXT_DOC_ROOT_COLORS } from "./constants";
import {
  matchesContextDocFilter,
  mergeContextDocs,
  reorderContextDocRows,
  serializeProjectContextPreview,
  type ContextDocRow,
} from "./helpers";
import { s } from "./styles";

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { repoId } = useActiveRepo();

  const {
    data: docsResponse,
    isLoading: docsLoading,
    isError: docsError,
    refetch: refetchDocs,
  } = useContextDocs(repoId);
  const {
    data: links,
    isLoading: linksLoading,
    isError: linksError,
    refetch: refetchLinks,
  } = useSkillContextDocs(skill.id, repoId);
  const setDocs = useSetSkillContextDocs(skill.id, repoId);
  const setEnabled = useSetSkillContextDocEnabled(skill.id, repoId);

  const [filter, setFilter] = React.useState("");
  const [dragPath, setDragPath] = React.useState<string | null>(null);
  const [overPath, setOverPath] = React.useState<string | null>(null);
  // Optimistic order for an in-flight drag reorder only — same
  // set-on-drop/clear-on-own-settle pattern as SkillsTab.tsx (see
  // client/INSIGHTS.md's 2026-08-06/2026-08-07 entries on why a plain
  // useEffect-synced copy or an unguarded onSettled both reintroduce a
  // race with a second overlapping drag).
  const [optimisticRows, setOptimisticRows] = React.useState<ContextDocRow[] | null>(null);
  const dragTokenRef = React.useRef(0);

  const merged = React.useMemo(
    () => mergeContextDocs(docsResponse?.documents, links),
    [docsResponse, links],
  );
  const rows = optimisticRows ?? merged;

  const loading = docsLoading || linksLoading;
  const isError = docsError || linksError;
  const total = rows.length;
  const attachedEnabled = rows.filter((r) => r.link?.enabled).length;
  const visible = rows.filter((r) => matchesContextDocFilter(r, filter));

  const serialized = React.useMemo(
    () => serializeProjectContextPreview(rows.filter((r) => r.link?.enabled).map((r) => r.path)),
    [rows],
  );

  function handleToggle(path: string, enabled: boolean) {
    setEnabled.mutate({ path, enabled });
  }

  // Shared persistence tail for BOTH mouse drag-drop and the keyboard
  // equivalent below — takes an already-computed full row order and runs
  // the identical optimistic-set + `setDocs.mutate` + token-guarded
  // `onSettled` sequence (AC-42; see the drag-race comment above
  // `optimisticRows`). Only how `next` gets computed differs between the two
  // input modes (see `handleHandleKeyDown`'s comment for why).
  function persistReorder(next: ContextDocRow[]) {
    setOptimisticRows(next);
    const token = ++dragTokenRef.current;
    setDocs.mutate(
      next.map((r) => r.path),
      {
        onSettled: () => {
          if (dragTokenRef.current === token) setOptimisticRows(null);
        },
      },
    );
  }

  function handleDrop(targetPath: string) {
    if (dragPath && dragPath !== targetPath) {
      persistReorder(reorderContextDocRows(rows, dragPath, targetPath));
    }
    setDragPath(null);
    setOverPath(null);
  }

  // Keyboard-operable equivalent of drag-drop reordering (AC-42): ArrowUp/
  // ArrowDown move the focused handle's row by exactly one position (a plain
  // adjacent swap) and persist via the same `persistReorder` tail a mouse
  // drag-drop uses. This is intentionally NOT `reorderContextDocRows` —
  // that helper's "insert dragged row just before the target" semantics is
  // right for a drop target chosen by pointer position, but produces a
  // no-op for an adjacent forward swap (dropping A onto the very next row B
  // re-inserts A right back before B). A one-key-press-equals-one-slot swap
  // is also the APG "Reorder" pattern for a single grip control — no
  // separate Enter-to-pick-up/Enter-to-drop mode is needed since there's
  // nothing else the handle does once focused.
  function handleHandleKeyDown(e: React.KeyboardEvent, path: string) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const index = rows.findIndex((r) => r.path === path);
    if (index === -1) return;
    const targetIndex = e.key === "ArrowUp" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= rows.length) return;
    const next = rows.slice();
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved!);
    persistReorder(next);
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("context.title")}</h2>
        <Badge color="var(--text-secondary)">
          {t("context.enabledCount", { attached: attachedEnabled, total })}
        </Badge>
        <div style={s.filter}>
          <Icon.Search size={13} style={s.filterIcon} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("context.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>
      <div style={s.hint}>{t("context.subtitle")}</div>

      {!isError && !loading && (
        <div role="status" aria-live="polite" style={s.srOnly}>
          {t("context.resultCount", { count: visible.length })}
        </div>
      )}
      {isError ? (
        <ErrorState
          body={t("context.loadError")}
          onRetry={() => {
            void refetchDocs();
            void refetchLinks();
          }}
        />
      ) : loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      ) : visible.length === 0 ? (
        <div style={s.list}>
          <div style={s.empty}>{t("context.emptyFilter")}</div>
        </div>
      ) : (
        <div style={s.list} data-testid="context-doc-list">
          {visible.map((row) => {
            const enabled = row.link?.enabled ?? false;
            const missing = !!row.link && !row.document;
            return (
              <div
                key={row.path}
                style={s.row(overPath === row.path && dragPath !== row.path)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragPath) setOverPath(row.path);
                }}
                onDragLeave={() => setOverPath((cur) => (cur === row.path ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(row.path);
                }}
              >
                <span
                  draggable
                  tabIndex={0}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", row.path);
                    setDragPath(row.path);
                  }}
                  onDragEnd={() => {
                    setDragPath(null);
                    setOverPath(null);
                  }}
                  onKeyDown={(e) => handleHandleKeyDown(e, row.path)}
                  style={s.handle}
                  aria-label={`Reorder ${row.path} — use arrow keys to reorder`}
                  role="button"
                >
                  <Icon.Menu size={14} />
                </span>
                <Checkbox checked={enabled} onChange={(v) => handleToggle(row.path, v)} />
                <span className="mono" style={s.name}>
                  {row.path}
                </span>
                {missing && (
                  <span style={s.missing}>
                    <Icon.AlertTriangle size={12} />
                    {t("context.missing")}
                  </span>
                )}
                {row.document && (
                  <Badge color={CONTEXT_DOC_ROOT_COLORS[row.document.root]}>{row.document.root}</Badge>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={s.previewPanel}>
        <div style={s.previewLabel}>{t("context.serializesAs")}</div>
        <pre style={s.previewText}>{serialized || t("context.previewEmpty")}</pre>
      </div>
    </div>
  );
}
