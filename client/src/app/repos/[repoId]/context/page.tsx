/* Project Context browser — /repos/:repoId/context. Lists every markdown
   document discovered under the repo's configured search roots
   (specs/docs/insights), grouped by root, with a coverage indicator and a
   read-only Preview pane (see
   specs/cross-cutting/project-context-folder/spec.md §6.4, AC-13..AC-16).
   Structurally mirrors conventions/page.tsx's useActiveRepo/useRepoNotFound/
   loading-error-empty-populated shape; the list/row/preview rendering itself
   is delegated to the already-built ContextDocGroup/ContextDocRow/
   DocumentPreviewPane components in ./_components. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useContextDocs, useReindexContextDocs } from "@/lib/hooks/context-docs";
import { ApiError } from "@/lib/api";
import { ContextDocGroup } from "./_components/ContextDocGroup";
import { DocumentPreviewPane } from "./_components/DocumentPreviewPane";
import { DEGRADED_STATUS_LABEL, ROOT_ORDER, SKELETON_ROWS } from "./constants";
import { groupByRoot, relativeTime } from "./helpers";
import { s } from "./styles";

export default function ContextPage() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, error, refetch } = useContextDocs(repoId);
  const reindex = useReindexContextDocs(repoId);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  // Server render always has `activeRepo: null` (client-only useRepos()
  // query) — gate the friendly name behind a post-mount flag so the first
  // client paint stays byte-identical to the server's (same reasoning as
  // conventions/page.tsx).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const repoName = mounted ? (activeRepo?.full_name ?? repoId) : repoId;

  const documents = data?.documents ?? [];
  const grouped = groupByRoot(documents);
  const indexStatus = data?.index_status;
  const notIndexed = indexStatus === "not_indexed";

  // Whole-repo chunk-count cell for the status line: the real total when
  // indexed, or a degraded-status label instead (AC-9/AC-10, mirrors
  // helpers.ts's per-document `chunkCountLabel`) — never both, never shown
  // at all for a never-indexed repo. Narrows directly on `data.index_status`
  // (not the separately-extracted `indexStatus` const above) so TS can
  // discriminate the union at each branch.
  let chunksLabel: string | null = null;
  if (data && data.index_status !== "not_indexed") {
    chunksLabel =
      data.index_status === "indexed"
        ? t("chunks", { count: data.total_chunk_count ?? 0 })
        : (DEGRADED_STATUS_LABEL[data.index_status] ?? t("chunks", { count: 0 }));
  }

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbContext") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbContext") }]}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>
            {t("page.headingPrefix")}
            {repoName}
          </h1>
          <p style={s.pageSubtitle}>{t("page.subtitle", { count: documents.length })}</p>
        </div>
        <div style={s.headerActions}>
          <Button
            kind="secondary"
            icon="RefreshCw"
            disabled={reindex.isPending || notIndexed}
            onClick={() => reindex.mutate()}
          >
            {reindex.isPending ? t("indexing") : t("reindex")}
          </Button>
        </div>
      </div>

      {data && !notIndexed && (
        <div style={s.toolbar}>
          <Badge icon="Gauge">
            {t("page.coverageLabel")}: {data.coverage_percent}%
          </Badge>
          <span style={s.statusLine}>
            {t("page.statusLine", {
              files: data.file_count,
              chunks: chunksLabel ?? "",
              when: relativeTime(data.last_indexed_at),
            })}
          </span>
        </div>
      )}

      <div style={s.body}>
        <div style={s.list}>
          {isLoading ? (
            <div style={s.loadingStack}>
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <Skeleton key={i} height={40} />
              ))}
            </div>
          ) : isError ? (
            <ErrorState
              title={t("page.loadError")}
              body={error instanceof ApiError ? error.message : t("page.loadError")}
              onRetry={() => refetch()}
            />
          ) : notIndexed ? (
            <EmptyState icon="Folder" title={t("page.notIndexed.title")} body={t("page.notIndexed.body")} />
          ) : documents.length === 0 ? (
            <EmptyState
              icon="FileText"
              title={t("page.empty.title")}
              body={t("page.empty.body")}
              cta={t("page.empty.cta")}
              onCta={() => reindex.mutate()}
              ctaLoading={reindex.isPending}
            />
          ) : (
            ROOT_ORDER.map((root) => (
              <ContextDocGroup
                key={root}
                root={root}
                documents={grouped[root]}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
              />
            ))
          )}
        </div>

        {!isLoading && !isError && !notIndexed && documents.length > 0 && (
          <div style={s.preview}>
            <DocumentPreviewPane repoId={repoId} path={selectedPath} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
