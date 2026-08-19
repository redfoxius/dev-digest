/* ContextDocRow — one discovered document in the Project Context page's
   grouped list. Read-only: clicking it only selects it for the Preview pane
   (AC-13/AC-14) — no edit/delete affordance lives on this row. */
"use client";

import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { ContextDocument } from "@devdigest/shared";
import { chunkCountLabel } from "../../helpers";
import { s } from "./styles";

export function ContextDocRow({
  doc,
  selected,
  onSelect,
}: {
  doc: ContextDocument;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("context");
  const chunks = chunkCountLabel(doc);
  return (
    <button type="button" style={s.row(selected)} onClick={onSelect} aria-pressed={selected}>
      <Icon.FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span className="mono" style={s.path}>
        {doc.path}
      </span>
      <span style={s.usedBy}>
        {t("page.usedBy", { agents: doc.used_by_agents, skills: doc.used_by_skills })}
      </span>
      {"count" in chunks ? (
        <Badge icon="Database">{t("chunks", { count: chunks.count })}</Badge>
      ) : (
        <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
          {chunks.label}
        </Badge>
      )}
    </button>
  );
}
