/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore, Dropdown, SeverityCounts } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { usePrReviews } from "@/lib/hooks/reviews";
import { FindingsPopoverList } from "@/components/findings-popover/FindingsPopoverList";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";
import { formatCostPair } from "@/lib/format";

export function PRRow({
  pr,
  repoId,
  repoFullName,
}: {
  pr: PrMeta;
  repoId: string;
  repoFullName?: string | null;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const [findingsOpen, setFindingsOpen] = React.useState(false);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed

  // Lazy: only fetch the PR's reviews once the findings popover is actually
  // opened, filtered + merged down to the reviews the list's live counts
  // came from (every agent from the PR's LAST review action, not just one).
  const reviewsQuery = usePrReviews(pr.id, findingsOpen);
  const latestReviewIds = pr.latest_review_ids;
  const latestFindings = latestReviewIds
    ? reviewsQuery.data
        ?.filter((r) => latestReviewIds.includes(r.id))
        .flatMap((r) => r.findings)
    : undefined;

  // The reviews query is cached under ["reviews", pr.id] and shared with
  // other views (e.g. a prior visit to the PR detail page while a review
  // was still running) — reopening this popover can serve THAT stale,
  // incomplete cache entry (TanStack's `isLoading` is false whenever any
  // cached data exists, even from before the review that just landed). If
  // the cache doesn't yet contain every review the list says is part of
  // the latest batch, treat it as loading and force a refetch, rather than
  // confidently rendering "No findings" from data that predates the review.
  const fetchedReviewIds = new Set((reviewsQuery.data ?? []).map((r) => r.id));
  const missingExpectedReviews =
    !!latestReviewIds && !latestReviewIds.every((id) => fetchedReviewIds.has(id));
  React.useEffect(() => {
    if (findingsOpen && missingExpectedReviews && !reviewsQuery.isFetching) {
      reviewsQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findingsOpen, missingExpectedReviews, reviewsQuery.isFetching]);

  const hasFindings =
    pr.findings != null &&
    (pr.findings.critical > 0 || pr.findings.warning > 0 || pr.findings.suggestion > 0);

  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div style={s.findingsCell} onClick={(e) => e.stopPropagation()}>
        {pr.findings == null ? (
          <span style={s.muted}>—</span>
        ) : !hasFindings ? (
          <Badge dot color="var(--ok)" bg="transparent">
            {t("list.findingsNone")}
          </Badge>
        ) : (
          <Dropdown
            width={320}
            onOpenChange={setFindingsOpen}
            trigger={<SeverityCounts counts={pr.findings} />}
          >
            <FindingsPopoverList
              findings={latestFindings}
              loading={reviewsQuery.isLoading || missingExpectedReviews}
              repoFullName={repoFullName}
              headSha={pr.head_sha}
            />
          </Dropdown>
        )}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div className="mono" style={s.costCell}>
        {formatCostPair(pr.latest_run_cost_usd, pr.cost_usd)}
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
