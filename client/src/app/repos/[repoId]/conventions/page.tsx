/* Conventions Extractor — /repos/:repoId/conventions. Scan the cloned repo
   for house-rules (deterministic config parsers + a cheap-model pass, both
   verified against real code before persisting — see
   docs/conventions-extractor-plan.md), accept/reject/edit each candidate,
   then bundle the accepted ones into a Skill. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useRepoIntelStatus } from "@/lib/hooks/repo-intel";
import { useConventions, useExtractConventions, useUpdateConvention } from "@/lib/hooks/conventions";
import { ApiError } from "@/lib/api";
import type { Skill } from "@devdigest/shared";
import { ConventionCandidateCard } from "./_components/ConventionCandidateCard";
import { CreateSkillFromConventionsModal } from "./_components/CreateSkillFromConventionsModal";
import { s } from "./styles";

const SKELETON_ROWS = 3;

// Mirrors ConventionCandidateCard's own LANGUAGE_LABEL — two 2-entry local
// maps in the same feature folder didn't yet justify a shared export (see
// client/INSIGHTS.md's "if a 4th consumer shows up, promote" convention).
// Phase 7.4, docs/go-language-support-plan.md.
const LANGUAGE_LABEL: Record<string, string> = {
  typescript: "TypeScript/JavaScript",
  go: "Go",
};

export default function ConventionsPage() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: candidates, isLoading, isError, error, refetch } = useConventions(repoId);
  const { data: indexState } = useRepoIntelStatus(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);
  const [pendingIds, setPendingIds] = React.useState<ReadonlySet<string>>(new Set());
  const [modalOpen, setModalOpen] = React.useState(false);
  const [languageFilter, setLanguageFilter] = React.useState<string | null>(null);

  // Server render always has `activeRepo: null` (it comes from a client-only
  // useRepos() query) — gating the friendly name behind a post-mount flag
  // keeps the FIRST client paint byte-identical to the server's, so React
  // never has to discard and regenerate this subtree during hydration.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const repoName = mounted ? (activeRepo?.full_name ?? repoId) : repoId;
  const list = candidates ?? [];
  const acceptedIds = list.filter((c) => c.status === "accepted").map((c) => c.id);
  const hasScanned = list.length > 0 || extract.isSuccess;
  // Only surfaced when 2+ languages are actually present — a single-language
  // repo has nothing to filter, same "don't build a switcher for one option"
  // reasoning as this codebase's repo switcher (client/INSIGHTS.md).
  const presentLanguages = Array.from(
    new Set(list.map((c) => c.language).filter((l): l is string => !!l)),
  ).sort();
  // Filtering is view-only: acceptedIds/deselectAll/counter still operate on
  // the full repo-wide set, not just what's currently visible.
  const visibleList = languageFilter ? list.filter((c) => c.language === languageFilter) : list;

  const setStatus = (id: string, status: "accepted" | "rejected" | "pending") => {
    setPendingIds((prev) => new Set(prev).add(id));
    update.mutate(
      { id, patch: { status } },
      {
        onSettled: () =>
          setPendingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }),
      },
    );
  };

  const deselectAll = () => {
    for (const id of acceptedIds) {
      update.mutate({ id, patch: { status: "pending" } });
    }
  };

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>
            {t("page.headingPrefix")}
            {repoName}
          </h1>
          <p style={s.pageSubtitle}>
            {hasScanned
              ? t("page.candidateCount", { count: list.length })
              : t("page.subtitle")}
          </p>
        </div>
        <div style={s.headerActions}>
          <Button
            kind="secondary"
            icon="RefreshCw"
            disabled={extract.isPending}
            onClick={() => extract.mutate()}
          >
            {extract.isPending ? t("page.scanning") : hasScanned ? t("page.rescan") : t("page.runExtraction")}
          </Button>
        </div>
      </div>

      {hasScanned && (
        <div style={s.toolbar}>
          <Button kind="ghost" size="sm" onClick={deselectAll} disabled={acceptedIds.length === 0}>
            Deselect all
          </Button>
          <span style={s.counter}>
            {acceptedIds.length} of {list.length} accepted
          </span>
          {presentLanguages.length > 1 && (
            <div style={s.languageFilter}>
              <Button
                kind="ghost"
                size="sm"
                active={languageFilter === null}
                onClick={() => setLanguageFilter(null)}
              >
                All languages
              </Button>
              {presentLanguages.map((lang) => (
                <Button
                  key={lang}
                  kind="ghost"
                  size="sm"
                  active={languageFilter === lang}
                  onClick={() => setLanguageFilter(lang)}
                >
                  {LANGUAGE_LABEL[lang] ?? lang}
                </Button>
              ))}
            </div>
          )}
          <div style={s.toolbarRight}>
            <Button
              kind="primary"
              icon="Sparkles"
              disabled={acceptedIds.length === 0}
              onClick={() => setModalOpen(true)}
            >
              Create skill
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={s.loadingStack}>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} height={90} />
          ))}
        </div>
      ) : isError ? (
        <div style={s.list}>
          <ErrorState
            title={t("page.loadError")}
            body={error instanceof ApiError ? error.message : t("page.loadError")}
            onRetry={() => refetch()}
          />
        </div>
      ) : !hasScanned ? (
        <div style={s.list}>
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => extract.mutate()}
            ctaLoading={extract.isPending}
          />
        </div>
      ) : (
        <div style={s.list}>
          {visibleList.map((c) => (
            <ConventionCandidateCard
              key={c.id}
              c={c}
              repoFullName={activeRepo?.full_name}
              sha={indexState?.lastIndexedSha}
              pending={pendingIds.has(c.id)}
              onAccept={() => setStatus(c.id, c.status === "accepted" ? "pending" : "accepted")}
              onReject={() => setStatus(c.id, c.status === "rejected" ? "pending" : "rejected")}
              onRuleChange={(rule) => update.mutate({ id: c.id, patch: { rule } })}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <CreateSkillFromConventionsModal
          repoId={repoId}
          repoLabel={repoName}
          candidateIds={acceptedIds}
          onClose={() => setModalOpen(false)}
          onCreated={(_skill: Skill) => setModalOpen(false)}
        />
      )}
    </AppShell>
  );
}
