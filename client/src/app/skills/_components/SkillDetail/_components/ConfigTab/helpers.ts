import { CHARS_PER_TOKEN } from "./constants";

/** Filename-style header shown above the body editor — kebab-cases the
   skill's name (falling back to a placeholder while blank), matching the
   design's "pr-quality-rubric.md" file-tab look. */
export function bodyFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "untitled-skill"}.md`;
}

/** Ballpark token count for the live counter — chars / CHARS_PER_TOKEN. */
export function estimateTokens(body: string): number {
  return Math.round(body.length / CHARS_PER_TOKEN);
}
