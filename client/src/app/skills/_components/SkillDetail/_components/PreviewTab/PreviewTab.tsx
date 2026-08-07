/* PreviewTab — read-only render of the skill body exactly as the reviewing
   agent receives it (the raw Markdown, wrapped as untrusted data server-side
   at prompt-assembly time — see reviewer-core's `assemblePrompt()`). */
"use client";

import { useTranslations } from "next-intl";
import { Badge, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { needsVetting } from "../../../../../../lib/skills";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={s.caption}>Rendered as the reviewing agent receives it.</span>
        {needsVetting(skill) && (
          <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
            {t("preview.untrustedBadge")}
          </Badge>
        )}
      </div>
      <div style={s.card}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
