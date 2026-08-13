import type { SmartDiffRole } from "@devdigest/shared";

/** Small role-color dot shown in each group's header. No shared role-color
 *  token exists anywhere else in this codebase (only severity's `SEV` map,
 *  `vendor/ui/primitives/tokens.ts`) — genuinely new, kept local to this one
 *  component. Matches the mockup's blue/orange/gray per-role marks. */
export const ROLE_COLORS: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  wiring: "var(--warn)",
  boilerplate: "var(--text-muted)",
};

/** Section open/closed defaults — a hard override independent of any
 *  individual file's size or findings (`core`/`wiring` start open, a
 *  lockfile-heavy `boilerplate` group starts collapsed). */
export const DEFAULT_SECTION_OPEN: Record<SmartDiffRole, boolean> = {
  core: true,
  wiring: true,
  boilerplate: false,
};
