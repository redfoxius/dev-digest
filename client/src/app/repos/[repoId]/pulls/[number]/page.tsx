/* PR Detail — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Basic file-by-file diff viewer in the Files tab
   Tab state lives in query (?tab). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { PrDetailHeader } from "./_components/PrDetailHeader";
import { OverviewTab } from "./_components/OverviewTab";
import { FindingsTab } from "./_components/FindingsTab";
import { DiffTab } from "./_components/DiffTab";
import { BlastTab } from "./_components/BlastTab";
import RunTraceDrawer from "./_components/RunTraceDrawer";
import { usePullDetail, usePulls } from "../../../../../lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { usePrReviews, useCancelRun, usePrActiveRuns, usePrRuns, useDeleteRun } from "../../../../../lib/hooks/reviews";
import { usePrBlastRadius } from "@/lib/hooks/blast";
import { usePrRiskBrief } from "@/lib/hooks/risk-brief";
import { buildFlaggedRefsMap } from "@/lib/risk-brief-helpers";
import { useActiveRepo, useRepoNotFound } from "../../../../../lib/repo-context";
import { ApiError } from "../../../../../lib/api";
import { githubPrUrl, githubBlobUrl } from "../../../../../lib/github-urls";
import type { FindingRecord } from "@devdigest/shared";
import type { ScrollTarget } from "../../../../../components/diff-viewer";

export default function PRDetailPage() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun();
  const invalidateActiveRuns = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
  };
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
  };

  // Fires on every run-batch completion, regardless of which run finished it
  // (SSE, from RunStatus while the Findings tab is mounted) or which tab is
  // currently active (the poll-driven fallback below). usePrReviews has no
  // refetchInterval of its own — this is the only thing that keeps its
  // results fresh, so both paths must converge here.
  const handleRunSettled = React.useCallback(() => {
    invalidateActiveRuns();
    invalidateRunHistory();
    refetchReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prId]);

  // Poll-driven fallback: usePrActiveRuns (reviewRunning) already polls every
  // 4s regardless of which tab is mounted, unlike the SSE-driven RunStatus
  // it's paired with below — so a run that completes while the user is on
  // Overview/Files-changed (Findings tab, and RunStatus with it, unmounted)
  // still gets its results refreshed within ~4s instead of staying stale
  // until a full reload. Harmless overlap with the SSE-driven onRunDone below
  // when both observe the same completion.
  const prevReviewRunningRef = React.useRef(false);
  React.useEffect(() => {
    if (prevReviewRunningRef.current && !reviewRunning) handleRunSettled();
    prevReviewRunningRef.current = reviewRunning;
  }, [reviewRunning, handleRunSettled]);

  const tab = search.get("tab") ?? "overview";
  const traceRunId = search.get("trace");
  const setParam = (key: string, val: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (val == null) sp.delete(key);
    else sp.set(key, val);
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const setTab = (t: string) => setParam("tab", t);

  // "View in diff" (Findings tab → Files-changed tab). nonce is bumped on
  // every request so a re-click of the same {file, line} still re-fires the
  // scroll even though DiffTab fully unmounts/remounts between tab switches.
  const [diffScrollTarget, setDiffScrollTarget] = React.useState<ScrollTarget | null>(null);
  function handleViewInDiff(file: string, line: number) {
    setDiffScrollTarget((prev) => ({ path: file, line, nonce: (prev?.nonce ?? 0) + 1 }));
    setTab("diff");
  }

  // Blast Radius callers are frequently files this PR never touched, and
  // even for a caller file that IS part of the diff, repo-intel's `line`
  // numbers reflect whatever commit was last (re)indexed — not necessarily
  // this PR's own head SHA (a merged/older PR's diff is frozen at its own
  // commit; the index reflects the default branch's current state). "View in
  // Diff" can only be trusted when `indexed_sha` exactly matches this PR's
  // head SHA (the diff view renders that exact same file content); otherwise
  // the file is opened on GitHub at `indexed_sha`, where the line number is
  // guaranteed to be the one repo-intel actually parsed.
  const { data: blastData } = usePrBlastRadius(prId);
  const prFilePaths = React.useMemo(
    () => new Set((pr?.files ?? []).map((f) => f.path)),
    [pr?.files],
  );
  const blastMatchesDiffSnapshot = !!blastData?.indexed_sha && !!pr && blastData.indexed_sha === pr.head_sha;

  // PR Why + Risk Brief (specs/cross-cutting/pr-why-risk-brief) — same
  // `["pr-risk-brief", prId]` query key `RiskBriefCard`/`IntentCard`
  // self-fetch, so React Query dedupes to one network call. Derives the
  // BlastRadiusCard flagged-dot map here (AC-24) rather than inside that
  // card, per its own "parent-derived, no new data-fetch inside" contract.
  const { data: riskBrief } = usePrRiskBrief(prId);
  const flaggedRefs = React.useMemo(
    () => (riskBrief ? buildFlaggedRefsMap(riskBrief.risks, riskBrief.review_focus) : undefined),
    [riskBrief],
  );
  // What onViewInDiff below will actually treat as an in-app jump — empty
  // whenever the blast index doesn't match this PR's exact head SHA, even
  // though those files are technically in `pr.files` (see
  // blastMatchesDiffSnapshot's comment above).
  const inAppJumpFiles = blastMatchesDiffSnapshot ? prFilePaths : new Set<string>();
  function handleCallerClick(file: string, line: number) {
    if (blastMatchesDiffSnapshot && prFilePaths.has(file)) {
      handleViewInDiff(file, line);
      return;
    }
    const sha = blastData?.indexed_sha ?? pr?.head_sha;
    if (repoFullName && sha) {
      window.open(githubBlobUrl(repoFullName, sha, file, line), "_blank", "noopener,noreferrer");
    }
  }

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  const allFindings: FindingRecord[] = React.useMemo(
    () => runs.flatMap((r) => r.findings),
    [reviews],
  );
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        reviewRunning={reviewRunning}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateActiveRuns()}
      />

      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
        {tab === "overview" && (
          <OverviewTab
            prBody={pr.body}
            prId={prId}
            reviewSummary={{
              verdict: pr.verdict,
              score: pr.score,
              findings: pr.findings,
              latestRunCostUsd: pr.latest_run_cost_usd,
            }}
            onOpenBlast={() => setTab("blast")}
            onViewInDiff={handleCallerClick}
            prFilePaths={inAppJumpFiles}
            riskBrief={{
              level: pr.risk_level,
              flaggedRefs,
              onJumpToDiff: handleViewInDiff,
            }}
          />
        )}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            cancelMutation={cancel}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={handleRunSettled}
            onViewInDiff={handleViewInDiff}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            canComment={pr.status === "open"}
            scrollTarget={diffScrollTarget}
          />
        )}

        {tab === "blast" && (
          <BlastTab prId={prId} onViewInDiff={handleCallerClick} prFilePaths={inAppJumpFiles} />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}
