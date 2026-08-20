/* Onboarding Generator — /repos/:repoId/tour. A 5-section guided tour
   (Architecture overview, Critical paths, How to run locally, Guided
   reading path, First tasks) generated on demand from the repo's existing
   index, explicitly regenerable — never auto-generated on page load (AC-20).
   See docs/onboarding-generator-plan.md, specs/cross-cutting/onboarding-generator/spec.md. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useOnboardingTour, useRegenerateTour } from "@/lib/hooks/onboarding";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/toast";
import { OnboardingSectionCard } from "./_components/OnboardingSectionCard";
import { relativeTime, regenerateErrorMessage } from "./helpers";
import { s } from "./styles";

/** Loading state renders one skeleton block per real section — matching
   spec §10's "loading (skeleton sections)" UI-state entry — never a bare
   spinner (control point #4 of the implementation plan). */
const SKELETON_SECTIONS = 5;

export default function OnboardingTourPage() {
  const t = useTranslations("onboarding");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  // Full destructure (data/isLoading/isError/error/refetch) — dropping
  // `isError` here would silently degrade a real load failure into the
  // empty-state copy (client/INSIGHTS.md, 2026-08-06 entry).
  const { data, isLoading, isError, error, refetch } = useOnboardingTour(repoId);
  const regenerate = useRegenerateTour(repoId);

  const [dismissedError, setDismissedError] = React.useState(false);
  const [liveMessage, setLiveMessage] = React.useState("");
  const sectionRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  // Server render always has `activeRepo: null` — gate the friendly name
  // behind a post-mount flag so the first client paint stays byte-identical
  // to the server's (mirrors conventions/page.tsx's own convention).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const repoName = mounted ? (activeRepo?.full_name ?? repoId) : repoId;

  const tour = data?.tour ?? null;
  const hadExistingTour = tour != null;

  const errorCopy = {
    notIndexed: t("regenerateError.notIndexed"),
    failedWithPrevious: t("regenerateError.failedWithPrevious"),
    failedNoPrevious: t("regenerateError.failedNoPrevious"),
  };

  const handleRegenerate = () => {
    setDismissedError(false);
    regenerate.mutate(undefined, {
      onSuccess: () => setLiveMessage(t("regenerateSuccess")),
      onError: (err) => {
        setLiveMessage(regenerateErrorMessage(err as ApiError, hadExistingTour, errorCopy));
      },
    });
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard?.writeText(window.location.href);
      notify.success(t("share.copied"));
    } catch {
      // Clipboard access can be denied by the browser — no network call was
      // ever attempted either way (AC-25); nothing else to degrade to.
    }
  };

  const scrollToSection = (kind: string) => {
    sectionRefs.current[kind]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName }, { label: t("title") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  // AC-23 — a Regenerate failure never blanks the page: it renders as a
  // dismissible banner ALONGSIDE whatever content state (populated or
  // empty) is already showing, never replacing it.
  const regenerateErrorText =
    regenerate.isError && !dismissedError
      ? regenerateErrorMessage(regenerate.error as ApiError, hadExistingTour, errorCopy)
      : null;

  return (
    <AppShell crumb={[{ label: repoName }, { label: t("title") }]}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>
            {t("headingPrefix")}
            {repoName}
          </h1>
          {tour && (
            <p style={s.pageSubtitle}>
              {t("subtitle", {
                fileCount: data?.file_count ?? 0,
                relativeTime: relativeTime(data?.generated_at),
              })}
            </p>
          )}
        </div>
        <div style={s.headerActions}>
          {tour && (
            <Button kind="secondary" icon="Link" onClick={handleShare}>
              {t("share.cta")}
            </Button>
          )}
          {tour && (
            <Button
              kind="primary"
              icon="RefreshCw"
              disabled={regenerate.isPending}
              loading={regenerate.isPending}
              onClick={handleRegenerate}
            >
              {regenerate.isPending ? t("regenerating") : t("regenerate")}
            </Button>
          )}
        </div>
      </div>

      {/* AC-36 — announces the Regenerate outcome (success or failure) via
         an aria-live region, independent of the visible dismissible banner
         below. */}
      <div role="status" aria-live="polite" style={s.srOnly}>
        {liveMessage}
      </div>

      {regenerateErrorText && (
        <div style={{ ...s.banner, ...s.errorBanner }} role="alert">
          <span>{regenerateErrorText}</span>
          <button
            type="button"
            style={s.bannerDismiss}
            onClick={() => setDismissedError(true)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {tour && data?.stale && (
        <div style={{ ...s.banner, ...s.staleBanner }}>
          <span>{t("stale.title")}</span>
          <Button kind="ghost" size="sm" disabled={regenerate.isPending} onClick={handleRegenerate}>
            {t("stale.cta")}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div style={s.loadingStack} aria-label={t("title")}>
          {Array.from({ length: SKELETON_SECTIONS }).map((_, i) => (
            <Skeleton key={i} height={120} />
          ))}
        </div>
      ) : isError ? (
        <div style={s.list}>
          <ErrorState
            title={t("loadError.title")}
            body={error instanceof ApiError ? error.message : t("loadError.title")}
            onRetry={() => refetch()}
          />
        </div>
      ) : !tour ? (
        <div style={s.list}>
          <EmptyState
            icon="Workflow"
            title={t("generate.title")}
            body={t("generate.body")}
            cta={t("generate.cta")}
            onCta={handleRegenerate}
            ctaLoading={regenerate.isPending}
          />
        </div>
      ) : (
        <>
          <nav style={s.nav} aria-label={t("sections")}>
            {tour.sections.map((section) => (
              <button
                key={section.kind}
                type="button"
                style={s.navButton}
                onClick={() => scrollToSection(section.kind)}
              >
                {t(`sectionTitles.${section.kind}`)}
              </button>
            ))}
          </nav>
          <div style={s.list}>
            {tour.sections.map((section) => (
              <div
                key={section.kind}
                ref={(el) => {
                  sectionRefs.current[section.kind] = el;
                }}
              >
                <OnboardingSectionCard
                  section={section}
                  title={t(`sectionTitles.${section.kind}`)}
                  anchorId={`section-${section.kind}`}
                  repoFullName={activeRepo?.full_name ?? null}
                  indexedSha={data?.indexed_sha ?? null}
                  openOnGitHubLabel={t("openOnGitHub")}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
