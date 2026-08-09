/* ConventionCandidateCard — mirrors FindingCard's shape (MonoLink + githubBlobUrl
   for a clickable evidence path, ConfidenceNum, Accept/Reject actions). Rule
   title is inline-editable (click → text input → PATCH on blur/Enter). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ConfidenceNum, MonoLink } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

const CATEGORY_COLOR: Record<string, string> = {
  naming: "var(--accent-text)",
  "error-handling": "var(--danger)",
  "api-shape": "var(--accent-text)",
  imports: "var(--text-muted)",
  testing: "var(--ok)",
  security: "var(--danger)",
  formatting: "var(--text-muted)",
  architecture: "var(--accent-text)",
  "type-safety": "var(--warn)",
};

// Mirrors `server/src/modules/repo-intel/languages/index.ts`'s LANGUAGES
// labels — no server-only module to import client-side, so a small local
// map (same pattern as CATEGORY_COLOR above). Phase 7.4,
// docs/go-language-support-plan.md. Falls back to the raw id for any
// language id not yet in this map.
const LANGUAGE_LABEL: Record<string, string> = {
  typescript: "TypeScript/JavaScript",
  go: "Go",
};

function lineLabel(c: ConventionCandidate): string {
  if (c.evidence_line_start == null) return "";
  if (c.evidence_line_end != null && c.evidence_line_end !== c.evidence_line_start) {
    return `:${c.evidence_line_start}-${c.evidence_line_end}`;
  }
  return `:${c.evidence_line_start}`;
}

export function ConventionCandidateCard({
  c,
  repoFullName,
  sha,
  onAccept,
  onReject,
  onRuleChange,
  pending,
}: {
  c: ConventionCandidate;
  repoFullName?: string | null;
  sha?: string | null;
  onAccept?: () => void;
  onReject?: () => void;
  onRuleChange?: (rule: string) => void;
  pending?: boolean;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(c.rule);

  const fileHref =
    repoFullName && sha
      ? githubBlobUrl(repoFullName, sha, c.evidence_path, c.evidence_line_start ?? undefined, c.evidence_line_end ?? undefined)
      : undefined;

  const accentColor =
    c.status === "accepted" ? "var(--ok)" : c.status === "rejected" ? "var(--text-muted)" : "var(--warn)";
  const categoryColor = CATEGORY_COLOR[c.category] ?? "var(--text-muted)";

  const commitEdit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== c.rule) onRuleChange?.(trimmed);
    else setDraft(c.rule);
  };

  return (
    <div style={s.card(accentColor)}>
      <div style={s.main}>
        <div style={s.titleRow}>
          {editing ? (
            <input
              autoFocus
              style={s.titleInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") {
                  setDraft(c.rule);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <span style={s.title} onClick={() => setEditing(true)} title="Click to edit">
              {c.rule}
            </span>
          )}
          <span style={s.badge(categoryColor)}>{c.category}</span>
          <span style={s.badge("var(--text-muted)")}>
            {c.origin === "config" ? "From config" : "AI-detected"}
          </span>
          {c.language && (
            <span style={s.badge("var(--text-muted)")}>{LANGUAGE_LABEL[c.language] ?? c.language}</span>
          )}
        </div>

        <div style={s.evidenceBlock}>
          <div style={s.evidencePathRow}>
            <MonoLink href={fileHref}>
              {c.evidence_path}
              {lineLabel(c)}
            </MonoLink>
          </div>
          <pre style={s.evidenceCode}>{c.evidence_snippet}</pre>
        </div>

        <div style={s.metaRow}>
          <ConfidenceNum value={c.confidence} />
        </div>
      </div>

      <div style={s.actions}>
        <Button
          kind="secondary"
          size="sm"
          icon="Check"
          disabled={pending}
          active={c.status === "accepted"}
          onClick={onAccept}
        >
          {t("card.accepted")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          disabled={pending}
          active={c.status === "rejected"}
          onClick={onReject}
        >
          {t("card.reject")}
        </Button>
      </div>
    </div>
  );
}
