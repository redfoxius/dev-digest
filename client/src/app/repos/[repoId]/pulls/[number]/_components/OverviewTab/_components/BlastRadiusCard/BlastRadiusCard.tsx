"use client";

import React from "react";
import type { RiskSeverity } from "@devdigest/shared";
import { Badge, Button, Card, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrBlastRadius } from "@/lib/hooks/blast";
import { blastRadiusCounts, topBlastSymbols } from "@/lib/blast-stats";
import { ApiError } from "@/lib/api";
import { flaggedDotColor, withFlaggedSuffix } from "./helpers";
import { s } from "./styles";

interface BlastRadiusCardProps {
  prId: string | null | undefined;
  /** Switches the PR page to the full "Blast radius" tab (`?tab=blast`,
   *  BlastTab) — where every changed symbol is listed. */
  onViewFull: () => void;
  /** Jump to a caller's file:line — page.tsx's `handleCallerClick` routes to
   *  the Files-changed tab when the file is part of this PR's diff, or a
   *  GitHub blob link otherwise (a Blast caller is frequently a file this PR
   *  never touched). */
  onViewInDiff: (file: string, line: number) => void;
  /** Files where onViewInDiff will actually jump in-app (page.tsx already
   *  accounts for whether the blast index's commit matches this PR's head
   *  SHA, not just raw diff membership) — anything else shows a GitHub
   *  icon instead of the in-diff jump arrow. */
  prFilePaths: Set<string>;
  /** PR Why + Risk Brief (AC-24): parent-derived map of a caller's `file`
   *  or an endpoint/cron string to the highest-severity `RiskBrief.risks[]`
   *  entry citing it, or the neutral `'flagged'` sentinel when only cited
   *  via `review_focus[]`. This component never fetches this data itself —
   *  entirely parent-derived (`buildFlaggedRefsMap`). */
  flaggedRefs?: Map<string, RiskSeverity | "flagged">;
}

/** Small filled dot marking a flagged caller/endpoint/cron row — purely
 *  decorative (the accessible name carries the "flagged" text via the
 *  row's `title`), so it's `aria-hidden`. */
function FlaggedDot({ value }: { value: RiskSeverity | "flagged" }) {
  return (
    <span aria-hidden="true" data-testid="flagged-dot" style={{ ...s.flaggedDot, background: flaggedDotColor(value) }} />
  );
}

const PREVIEW_CALLER_COUNT = 4;
const PREVIEW_CHIP_COUNT = 6;

/**
 * Compact Blast Radius summary for the Overview tab (docs/blast-radius-plan.md,
 * mockup-driven placement). Shows the single most-impacted changed symbol
 * fully expanded — its callers and endpoint/cron chips, not just a name and
 * a count — with a link to the full "Blast radius" tab for everything else.
 * Self-contained fetching, same pattern as the sibling IntentCard.
 */
export function BlastRadiusCard({ prId, onViewFull, onViewInDiff, prFilePaths, flaggedRefs }: BlastRadiusCardProps) {
  const { data, isLoading, isError, error, refetch } = usePrBlastRadius(prId);
  const hasData = !!data && !data.degraded && data.changed_symbols.length > 0;
  const counts = hasData ? blastRadiusCounts(data!.downstream) : null;
  const topSymbol = hasData ? topBlastSymbols(data!.downstream, 1)[0] : undefined;

  return (
    <section>
      <Card>
        <SectionLabel
          icon="Target"
          right={
            hasData ? (
              <Button kind="ghost" size="sm" icon="ArrowRight" onClick={onViewFull}>
                View full blast radius
              </Button>
            ) : undefined
          }
        >
          Blast radius
        </SectionLabel>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={16} width="60%" />
            <Skeleton height={16} width="40%" />
          </div>
        )}

        {!isLoading && isError && (
          <ErrorState
            title="Couldn't load the blast radius"
            body={error instanceof ApiError ? error.message : "Something went wrong."}
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !isError && data?.degraded && (
          <p style={s.emptyText}>This repo hasn't been indexed yet, so no impact data is available.</p>
        )}

        {!isLoading && !isError && data && !data.degraded && data.changed_symbols.length === 0 && (
          <p style={s.emptyText}>This PR's diff didn't declare or modify any indexed symbol.</p>
        )}

        {!isLoading && !isError && data && hasData && counts && topSymbol && (
          <>
            <div style={s.statRow}>
              <CountBadge n={data.changed_symbols.length} noun="symbol" />
              <CountBadge n={counts.totalCallers} noun="caller" />
              {counts.totalEndpoints > 0 && (
                <Badge mono bg="var(--accent-bg)" color="var(--accent)">
                  <Icon.Globe size={11} style={{ marginRight: 4 }} />
                  {counts.totalEndpoints} endpoint{counts.totalEndpoints === 1 ? "" : "s"}
                </Badge>
              )}
              {counts.totalCrons > 0 && (
                <Badge mono bg="var(--warn-bg)" color="var(--warn)">
                  <Icon.Clock size={11} style={{ marginRight: 4 }} />
                  {counts.totalCrons} cron{counts.totalCrons === 1 ? "" : "s"}
                </Badge>
              )}
            </div>

            <div style={s.topSymbolBox}>
              <div style={s.topSymbolHeader}>
                <Icon.Code size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <span className="mono" style={s.symbolName}>
                  {topSymbol.symbol}()
                </span>
                <span style={{ flex: 1, minWidth: 8 }} />
                <span style={s.callerCount}>
                  {topSymbol.callers.length} caller{topSymbol.callers.length === 1 ? "" : "s"}
                </span>
              </div>

              {topSymbol.callers.length === 0 ? (
                <div style={s.emptyText}>No known callers outside this file.</div>
              ) : (
                <div style={s.callerList}>
                  {topSymbol.callers.slice(0, PREVIEW_CALLER_COUNT).map((c, i) => {
                    const external = !prFilePaths.has(c.file);
                    const flagged = flaggedRefs?.get(c.file);
                    const baseTitle = external
                      ? "Opens on GitHub — not part of this PR's diff"
                      : "Jump to this line in Files changed";
                    return (
                      <button
                        key={`${c.file}:${c.line}:${i}`}
                        onClick={() => onViewInDiff(c.file, c.line)}
                        style={s.callerRow}
                        title={flagged !== undefined ? withFlaggedSuffix(baseTitle, flagged) : baseTitle}
                      >
                        {flagged !== undefined && <FlaggedDot value={flagged} />}
                        {external ? (
                          <Icon.Github size={12} style={{ color: "var(--ok)", flexShrink: 0 }} />
                        ) : (
                          <Icon.CornerDownRight size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                        )}
                        <span className="mono" style={s.callerLink}>
                          {c.file}:{c.line}
                        </span>
                        <span style={s.callerName}>{c.name}</span>
                      </button>
                    );
                  })}
                  {topSymbol.callers.length > PREVIEW_CALLER_COUNT && (
                    <div style={s.moreCallers}>
                      +{topSymbol.callers.length - PREVIEW_CALLER_COUNT} more — see full blast radius
                    </div>
                  )}
                </div>
              )}

              {(topSymbol.endpoints_affected.length > 0 || topSymbol.crons_affected.length > 0) && (
                <ChipPreview
                  endpoints={topSymbol.endpoints_affected}
                  crons={topSymbol.crons_affected}
                  max={PREVIEW_CHIP_COUNT}
                  flaggedRefs={flaggedRefs}
                />
              )}
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

function CountBadge({ n, noun }: { n: number; noun: string }) {
  return (
    <Badge mono color="var(--text-secondary)">
      {n} {noun}
      {n === 1 ? "" : "s"}
    </Badge>
  );
}

/** Combined endpoint (blue) + cron (amber) chip row, capped at `max` total
 *  with a "+N more" tail — a compact-panel concern the full BlastTab
 *  (which lists every chip) doesn't need. */
function ChipPreview({
  endpoints,
  crons,
  max,
  flaggedRefs,
}: {
  endpoints: string[];
  crons: string[];
  max: number;
  flaggedRefs?: Map<string, RiskSeverity | "flagged">;
}) {
  const shownEndpoints = endpoints.slice(0, max);
  const shownCrons = crons.slice(0, Math.max(0, max - shownEndpoints.length));
  const hidden = endpoints.length + crons.length - shownEndpoints.length - shownCrons.length;

  return (
    <div style={s.chipRow}>
      {shownEndpoints.map((ep) => {
        const flagged = flaggedRefs?.get(ep);
        const badge = (
          <Badge bg="var(--accent-bg)" color="var(--accent)">
            {flagged !== undefined && <FlaggedDot value={flagged} />}
            <Icon.Globe size={11} style={{ marginRight: 4 }} />
            {ep}
          </Badge>
        );
        return flagged !== undefined ? (
          <span key={ep} title={withFlaggedSuffix(`Endpoint: ${ep}`, flagged)}>
            {badge}
          </span>
        ) : (
          <span key={ep}>{badge}</span>
        );
      })}
      {shownCrons.map((cr) => {
        const flagged = flaggedRefs?.get(cr);
        const badge = (
          <Badge bg="var(--warn-bg)" color="var(--warn)">
            {flagged !== undefined && <FlaggedDot value={flagged} />}
            <Icon.Clock size={11} style={{ marginRight: 4 }} />
            {cr}
          </Badge>
        );
        return flagged !== undefined ? (
          <span key={cr} title={withFlaggedSuffix(`Cron: ${cr}`, flagged)}>
            {badge}
          </span>
        ) : (
          <span key={cr}>{badge}</span>
        );
      })}
      {hidden > 0 && (
        <Badge bg="var(--bg-hover)" color="var(--text-muted)">
          +{hidden} more
        </Badge>
      )}
    </div>
  );
}

export default BlastRadiusCard;
