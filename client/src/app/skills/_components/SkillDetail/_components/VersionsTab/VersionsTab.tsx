/* VersionsTab — `skill_versions` history, newest first. Each row shows
   v{n}/summary/date; the current version shows just a "Current" tag, every
   older row gets Diff (client-side, against the current body) and Restore
   (creates a NEW version whose body matches the target — never rewrites
   history in place). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useRestoreSkillVersion, useSkillVersions } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { computeDiffLines } from "./helpers";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [diffOpenFor, setDiffOpenFor] = React.useState<number | null>(null);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={64} />
        <Skeleton height={64} />
      </div>
    );
  }
  if (isError) {
    return <ErrorState body={t("detail.loadError")} onRetry={() => refetch()} />;
  }
  if (!versions || versions.length === 0) {
    return <EmptyState icon="History" title="No version history yet" />;
  }

  return (
    <div style={s.wrap}>
      {versions.map((v) => {
        const isCurrent = v.version === skill.version;
        const diffOpen = diffOpenFor === v.version;
        return (
          <div key={v.version}>
            <Card style={s.row}>
              <div style={s.rowTop}>
                <span className="mono" style={s.versionTag}>
                  {t("preview.version", { version: v.version })}
                </span>
                <span style={s.summary}>{v.summary ?? "—"}</span>
                <span style={s.date}>{new Date(v.created_at).toLocaleString()}</span>
                {isCurrent ? (
                  <Badge color="var(--ok)" bg="var(--ok-bg)">
                    Current
                  </Badge>
                ) : (
                  <div style={s.actions}>
                    <Button
                      kind="tertiary"
                      size="sm"
                      icon="Layers"
                      active={diffOpen}
                      onClick={() => setDiffOpenFor(diffOpen ? null : v.version)}
                    >
                      Diff
                    </Button>
                    <Button
                      kind="secondary"
                      size="sm"
                      icon="RefreshCw"
                      disabled={restore.isPending}
                      onClick={() =>
                        restore.mutate(
                          { skillId: skill.id, version: v.version },
                          { onSuccess: (data) => toast.success(t("preview.version", { version: data.version })) },
                        )
                      }
                    >
                      Restore
                    </Button>
                  </div>
                )}
              </div>
              {diffOpen && (
                <div style={s.diffPanel}>
                  {computeDiffLines(v.body, skill.body).map((line, i) => (
                    <div key={i} style={s.diffLine(line.type)}>
                      {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
                      {line.text}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        );
      })}
    </div>
  );
}
