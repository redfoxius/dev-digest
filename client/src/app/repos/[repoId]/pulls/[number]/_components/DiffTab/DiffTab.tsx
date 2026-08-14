"use client";

import React from "react";
import { SectionLabel, Button, Chip } from "@devdigest/ui";
import { DiffViewer, SmartDiffViewer, type DiffCommentApi, type ScrollTarget } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { usePrSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** An external "view in diff" request from the Findings tab — forwarded
   *  to whichever viewer (Smart/Original order) is currently active. */
  scrollTarget?: ScrollTarget | null;
}

export function DiffTab({ prId, filesCount, files, canComment, scrollTarget }: DiffTabProps) {
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const { data: smartDiff } = usePrSmartDiff(prId);
  // While the query is loading, erroring, or the PR has zero files across
  // every group, there's nothing to group — the toggle stays hidden and this
  // tab silently falls back to the flat DiffViewer. A broken/slow smart-diff
  // call must never take down the base "show me the diff" function.
  const canUseSmartOrder = !!smartDiff?.groups.some((g) => g.files.length > 0);
  // Same local pattern as showComments above — plain useState, no URL
  // persistence, resets on reload.
  const [smartOrder, setSmartOrder] = React.useState(true);
  const showSmart = smartOrder && canUseSmartOrder;

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {canUseSmartOrder && (
              <>
                <Chip active={smartOrder} onClick={() => setSmartOrder(true)}>
                  Smart order
                </Chip>
                <Chip active={!smartOrder} onClick={() => setSmartOrder(false)}>
                  Original order
                </Chip>
              </>
            )}
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {showSmart ? (
        <SmartDiffViewer smartDiff={smartDiff!} files={files} commenting={commenting} scrollTarget={scrollTarget} />
      ) : (
        <DiffViewer files={files} commenting={commenting} scrollTarget={scrollTarget} />
      )}
    </section>
  );
}
