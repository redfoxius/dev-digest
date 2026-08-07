import type { SkillSource, SkillType } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Icon + color tint per skill type — drives the row's icon chip and the type
   badge (`listItem.type.*` supplies the label text). */
export const TYPE_META: Record<SkillType, { icon: IconName; color: string; bg: string }> = {
  rubric: { icon: "ListChecks", color: "var(--accent)", bg: "var(--accent-bg)" },
  security: { icon: "Shield", color: "var(--crit)", bg: "var(--crit-bg)" },
  convention: { icon: "Layers", color: "var(--warn)", bg: "var(--warn-bg)" },
  custom: { icon: "Wrench", color: "var(--info)", bg: "var(--info-bg)" },
};

/** Icon per skill source — paired with `listItem.source.*` for the label. */
export const SOURCE_ICON: Record<SkillSource, IconName> = {
  manual: "Edit",
  extracted: "FileText",
  community: "Users",
  imported_url: "Globe",
};
