import type { SkillType } from "@devdigest/shared";

/** Selectable skill types (labels come from `listItem.type.*`). */
export const SKILL_TYPE_VALUES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Rough chars-per-token ratio for the live "~N tokens" count next to the
   body editor — not a real tokenizer, just a ballpark so an over-long skill
   body is visibly obvious before it's saved. */
export const CHARS_PER_TOKEN = 4;
