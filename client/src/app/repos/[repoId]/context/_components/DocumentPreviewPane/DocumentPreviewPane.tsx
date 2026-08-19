/* DocumentPreviewPane — read-only render of a selected discovered document
   (AC-14). Deliberately has NO edit/save affordance anywhere in this tree:
   `server/clones/` is a git-ignored working checkout silently overwritten on
   the next repo sync (root CLAUDE.md's do-not-touch convention), so in-app
   editing was ruled out of scope for this feature — see
   specs/cross-cutting/project-context-folder/spec.md §12. Don't add a
   textarea, an Edit button, or any mutation call to this component. */
"use client";

import { EmptyState, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { useContextDocPreview } from "@/lib/hooks/context-docs";
import { s } from "./styles";

export function DocumentPreviewPane({
  repoId,
  path,
}: {
  repoId: string;
  path: string | null;
}) {
  const { data, isLoading, isError, error, refetch } = useContextDocPreview(repoId, path);

  if (!path) {
    return (
      <EmptyState
        icon="FileText"
        title="No document selected"
        body="Select a document from the list to preview its content."
      />
    );
  }

  if (isLoading) {
    return (
      <div style={s.loadingStack}>
        <Skeleton height={16} width="40%" />
        <Skeleton height={200} />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <ErrorState
        title={notFound ? "Document no longer discovered" : "Couldn't load this document"}
        body={
          notFound
            ? "This document is no longer present in the latest scan — it may have been deleted, moved, or renamed."
            : error instanceof ApiError
              ? error.message
              : undefined
        }
        onRetry={notFound ? undefined : () => refetch()}
      />
    );
  }

  if (!data) return null;

  return (
    <div style={s.wrap}>
      <div className="mono" style={s.path}>
        {data.path}
      </div>
      <div style={s.body}>
        <Markdown>{data.content}</Markdown>
      </div>
    </div>
  );
}
