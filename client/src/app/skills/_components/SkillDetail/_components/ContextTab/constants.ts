import type { ContextDocRoot } from "@devdigest/shared";

/** Colored root badge per discovered-document root — reuses existing
   semantic CSS vars, mirrors SkillsTab's SKILL_TYPE_COLORS pattern. */
export const CONTEXT_DOC_ROOT_COLORS: Record<ContextDocRoot, string> = {
  specs: "var(--info)",
  docs: "var(--accent)",
  insights: "var(--text-secondary)",
};

/** The literal heading `reviewer-core`'s `assemblePrompt` actually emits for
   the resolved-specs block (`reviewer-core/src/prompt.ts:158`,
   `## Project context\n${specsBlock}`) — NOT the mockup's illustrative
   `## Project specifications`. The "SERIALIZES AS" preview below is built
   from this exact string so it never drifts from the real assembled prompt
   text a run would actually produce (AC-25). */
export const PROJECT_CONTEXT_HEADING = "## Project context";

/** Stand-in for a resolved document's actual body text inside the preview's
   `<untrusted>` block. The preview deliberately does NOT fetch every
   enabled document's real content (that would mean an expensive fetch of
   every enabled document on every keystroke/toggle) — this placeholder
   keeps the STRUCTURAL shape (heading, wrapper, `### {path}` prefix,
   body-then-close) faithful to what `resolve.ts`/`wrapUntrusted()` actually
   produce, without claiming to show real file contents. */
export const PROJECT_CONTEXT_BODY_PLACEHOLDER = "...(document content)...";
