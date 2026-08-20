import type { ApiError } from "@/lib/api";

/** Compact relative time for the "last refreshed" subtitle — mirrors
   `repos/[repoId]/context/helpers.ts`'s own `relativeTime` copy (per this
   codebase's "each route owns its own copy until a 4th consumer shows up"
   convention, client/INSIGHTS.md). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "never";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Distinguishes the two honest failure messages a Regenerate call can
   surface (control point #4 of docs/onboarding-generator-plan.md): a 422
   `not_indexed` response (never-indexed repo — the server's own message
   already says so plainly) vs a 502 generation failure (message differs by
   whether a tour was already showing, so a previously-persisted tour is
   never implied lost). Never returns a generic "something went wrong" —
   every branch states plainly what happened. */
export function regenerateErrorMessage(
  error: ApiError | Error,
  hadExistingTour: boolean,
  t: {
    notIndexed: string;
    failedWithPrevious: string;
    failedNoPrevious: string;
  },
): string {
  const code = "code" in error ? (error as ApiError).code : undefined;
  if (code === "not_indexed") return t.notIndexed;
  const base = hadExistingTour ? t.failedWithPrevious : t.failedNoPrevious;
  return error.message ? `${base} (${error.message})` : base;
}
