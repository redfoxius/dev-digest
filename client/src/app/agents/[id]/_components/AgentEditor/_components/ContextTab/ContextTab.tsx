/* ContextTab — Agent Editor's unified project-context-document list.
   One row per document discovered for the active repo (attached ones
   first, in order); a Checkbox both attaches and toggles injection, a drag
   handle reorders the FULL list (attached + unattached) via
   `useSetAgentContextDocs`, and a per-row Preview action opens the raw file
   content read-only. Structurally mirrors SkillsTab.tsx (same
   `optimisticRows`/`dragTokenRef` drag-reorder pattern, same `aria-live`
   result-count region) — see
   specs/cross-cutting/project-context-folder/spec.md §6.5 (AC-17..AC-22,
   AC-42) and docs/project-context-folder-plan.md's Work Item 14. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, ErrorState, Icon, Modal, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useAgentContextDocs,
  useContextDocPreview,
  useContextDocs,
  useSetAgentContextDocEnabled,
  useSetAgentContextDocs,
} from "@/lib/hooks/context-docs";
import { ROOT_TYPE_COLORS } from "./constants";
import {
  estimateAttachedTokens,
  matchesContextFilter,
  mergeContextDocs,
  reorderContextRows,
  type ContextDocRow,
} from "./helpers";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { repoId } = useActiveRepo();
  const {
    data: catalog,
    isLoading: catalogLoading,
    isError: catalogError,
    refetch: refetchCatalog,
  } = useContextDocs(repoId);
  const {
    data: links,
    isLoading: linksLoading,
    isError: linksError,
    refetch: refetchLinks,
  } = useAgentContextDocs(agent.id, repoId);
  const setDocs = useSetAgentContextDocs(agent.id, repoId);
  const setEnabled = useSetAgentContextDocEnabled(agent.id, repoId);

  const [filter, setFilter] = React.useState("");
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  const merged = React.useMemo(
    () => mergeContextDocs(catalog?.documents, links),
    [catalog?.documents, links],
  );
  // Optimistic order for an in-flight drag reorder only — see SkillsTab.tsx's
  // identical `optimisticRows`/`dragTokenRef` pattern for the full rationale
  // (a later unrelated `merged` recompute must not snap the list back
  // mid-drag, and only the LATEST of two overlapping drags may clear it).
  const [optimisticRows, setOptimisticRows] = React.useState<ContextDocRow[] | null>(null);
  const dragTokenRef = React.useRef(0);
  const rows = optimisticRows ?? merged;

  const loading = catalogLoading || linksLoading;
  const isError = catalogError || linksError;
  const total = rows.length;
  const attachedEnabled = rows.filter((row) => row.link?.enabled).length;
  const visible = rows.filter((row) => matchesContextFilter(row, filter));
  const tokenEstimate = estimateAttachedTokens(rows);

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
    setDocs.mutate(next.map((row) => row.path), {
      onSettled: () => {
        if (dragTokenRef.current === token) setOptimisticRows(null);
      },
    });
  }

  function handleDrop(targetPath: string) {
    if (dragId && dragId !== targetPath) {
      persistReorder(reorderContextRows(rows, dragId, targetPath));
    }
    setDragId(null);
    setOverId(null);
  }

  // Keyboard-operable equivalent of drag-drop reordering (AC-42): ArrowUp/
  // ArrowDown move the focused handle's row by exactly one position (a plain
  // adjacent swap) and persist via the same `persistReorder` tail a mouse
  // drag-drop uses. This is intentionally NOT `reorderContextRows` — that
  // helper's "insert dragged row just before the target" semantics is right
  // for a drop target chosen by pointer position, but produces a no-op for
  // an adjacent forward swap (dropping A onto the very next row B re-inserts
  // A right back before B). A one-key-press-equals-one-slot swap is also the
  // APG "Reorder" pattern for a single grip control — no separate
  // Enter-to-pick-up/Enter-to-drop mode is needed since there's nothing else
  // the handle does once focused.
  function handleHandleKeyDown(e: React.KeyboardEvent, path: string) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const index = rows.findIndex((row) => row.path === path);
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
          {t("context.attachedCount", { attached: attachedEnabled, total })}
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
      <div style={s.hint}>{t("context.orderHint")}</div>

      {!isError && !loading && (
        <div role="status" aria-live="polite" style={s.srOnly}>
          {t("context.resultCount", { count: visible.length })}
        </div>
      )}
      {isError ? (
        <ErrorState
          body={t("context.loadError")}
          onRetry={() => {
            void refetchCatalog();
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
          <div style={s.empty}>{t("context.empty")}</div>
        </div>
      ) : (
        <div style={s.list}>
          {visible.map((row) => {
            const enabled = row.link?.enabled ?? false;
            // Only an ATTACHED row can be flagged missing — an unattached
            // row's `document` always comes straight from the live catalog,
            // so it can never itself be null (AC-22).
            const missing = row.link !== undefined && row.document === null;
            return (
              <div
                key={row.path}
                style={s.row(overId === row.path && dragId !== row.path)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragId) setOverId(row.path);
                }}
                onDragLeave={() => setOverId((cur) => (cur === row.path ? null : cur))}
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
                    setDragId(row.path);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  onKeyDown={(e) => handleHandleKeyDown(e, row.path)}
                  style={s.handle}
                  aria-label={`Reorder ${row.path} — use arrow keys to reorder`}
                  role="button"
                >
                  <Icon.Menu size={14} />
                </span>
                <Checkbox checked={enabled} onChange={(v) => handleToggle(row.path, v)} />
                <span className="mono" style={s.path}>
                  {row.path}
                </span>
                {missing ? (
                  <span style={s.missing}>
                    <Icon.AlertTriangle size={12} />
                    {t("context.missing")}
                  </span>
                ) : (
                  row.document && (
                    <Badge color={ROOT_TYPE_COLORS[row.document.root]}>{row.document.root}</Badge>
                  )
                )}
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Eye"
                  disabled={!row.document}
                  onClick={() => setPreviewPath(row.path)}
                >
                  {t("context.preview")}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {!isError && !loading && (
        <div style={s.footer}>
          <span>{t("context.tokensEstimate", { count: tokenEstimate })}</span>
        </div>
      )}

      {previewPath && (
        <ContextDocPreviewModal repoId={repoId} path={previewPath} onClose={() => setPreviewPath(null)} />
      )}
    </div>
  );
}

/** Read-only preview popover for a single document's raw content (AC-14's
   no-edit-affordance precedent, reused here for the Context tab's per-row
   Preview action). Small enough to stay colocated in this file rather than
   its own component folder, per this feature's file-anatomy scope. */
function ContextDocPreviewModal({
  repoId,
  path,
  onClose,
}: {
  repoId: string | null | undefined;
  path: string;
  onClose: () => void;
}) {
  const t = useTranslations("agents");
  const { data, isLoading, isError } = useContextDocPreview(repoId, path);
  return (
    <Modal title={path} onClose={onClose} width={640}>
      {isLoading ? (
        <div style={s.previewLoading}>
          <Skeleton height={200} />
        </div>
      ) : isError ? (
        <div style={s.previewLoading}>{t("context.previewLoadError")}</div>
      ) : (
        <pre style={s.previewBody}>{data?.content}</pre>
      )}
    </Modal>
  );
}
