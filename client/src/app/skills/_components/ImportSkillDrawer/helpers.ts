/** Best-effort name derivation for the paste form when the name field is left
   blank — mirrors the server's own `previewFileImport` fallback ("derive
   from the first `# heading` if blank") so the paste path (which posts
   straight to `POST /skills`, no name-deriving endpoint) doesn't force a
   name the copy promised was optional. Slugifies to the kebab-case shape
   `file.namePlaceholder` shows (`pr-quality-rubric`). */
export function deriveSkillName(body: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1] ?? "";
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** File-input `accept` + drop-zone validation — matches the archive-import
   convention (Claude-Code-style skill package: one main `.md` + optional
   supporting files) documented in docs/skills-feature-plan.md. */
export const ACCEPTED_EXTENSIONS = [".md", ".markdown", ".zip", ".tar", ".tar.gz"];

export function hasAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
