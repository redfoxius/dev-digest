/* BlastTab — "which symbols did this PR's diff change, who calls them, and
   which HTTP endpoints/cron jobs are reachable from those callers?"
   docs/blast-radius-plan.md. Read-only over the already-persisted repo-intel
   index (no AST/import-graph work happens client-side either). */
"use client";

import React from "react";
import { SectionLabel, Badge, Chip, Icon, Skeleton, EmptyState } from "@devdigest/ui";
import { usePrBlastRadius } from "@/lib/hooks/blast";
import { blastRadiusCounts } from "@/lib/blast-stats";
import { BlastGraphView } from "./BlastGraphView";
import type { DownstreamImpact } from "@devdigest/shared";

interface BlastTabProps {
  prId: string | null;
  /** Jump to a caller's file:line — unlike Findings, a Blast caller is
   *  frequently a file this PR never touched, so page.tsx's handler
   *  (`handleCallerClick`) opens a GitHub blob link for those instead of the
   *  Files-changed tab (which has nothing to show for an out-of-diff file). */
  onViewInDiff: (file: string, line: number) => void;
  /** Paths of this PR's own changed files — a caller row shows a GitHub icon
   *  when its file isn't one of these (external link), or the in-diff jump
   *  arrow otherwise. */
  prFilePaths: Set<string>;
}

export function BlastTab({ prId, onViewInDiff, prFilePaths }: BlastTabProps) {
  const { data, isLoading, isError } = usePrBlastRadius(prId);
  // Declared before any early return (Rules of Hooks) even though only the
  // "has data" render path below actually uses it.
  const [view, setView] = React.useState<"tree" | "graph">("tree");

  if (isLoading) {
    return (
      <section>
        <SectionLabel icon="Target">Blast radius</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section>
        <SectionLabel icon="Target">Blast radius</SectionLabel>
        <EmptyState
          icon="AlertTriangle"
          title="Couldn't load the blast radius"
          body="Something went wrong fetching the impact map for this PR."
        />
      </section>
    );
  }

  if (data.degraded) {
    return (
      <section>
        <SectionLabel icon="Target">Blast radius</SectionLabel>
        <EmptyState
          icon="Boxes"
          title="Blast radius isn't available yet"
          body={degradedMessage(data.reason)}
        />
      </section>
    );
  }

  if (data.changed_symbols.length === 0) {
    return (
      <section>
        <SectionLabel icon="Target">Blast radius</SectionLabel>
        <EmptyState
          icon="Target"
          title="No symbols were changed"
          body="This PR's diff didn't declare or modify any indexed symbol."
        />
      </section>
    );
  }

  const symbolMeta = new Map(data.changed_symbols.map((s) => [s.name, s]));
  const { totalCallers, totalEndpoints, totalCrons } = blastRadiusCounts(data.downstream);

  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Badge mono color="var(--text-secondary)">
              {data.changed_symbols.length} symbol{data.changed_symbols.length === 1 ? "" : "s"}
            </Badge>
            <Badge mono color="var(--text-secondary)">
              {totalCallers} caller{totalCallers === 1 ? "" : "s"}
            </Badge>
            {totalEndpoints > 0 && (
              <Badge mono bg="var(--accent-bg)" color="var(--accent)">
                <Icon.Globe size={11} style={{ marginRight: 4 }} />
                {totalEndpoints} endpoint{totalEndpoints === 1 ? "" : "s"}
              </Badge>
            )}
            {totalCrons > 0 && (
              <Badge mono bg="var(--warn-bg)" color="var(--warn)">
                <Icon.Clock size={11} style={{ marginRight: 4 }} />
                {totalCrons} cron{totalCrons === 1 ? "" : "s"}
              </Badge>
            )}
            <Chip active={view === "tree"} onClick={() => setView("tree")}>
              Tree
            </Chip>
            <Chip active={view === "graph"} onClick={() => setView("graph")}>
              Graph
            </Chip>
          </div>
        }
      >
        Blast radius
      </SectionLabel>

      <div style={{ fontSize: 13.5, color: "var(--text-secondary)", margin: "10px 0 16px" }}>
        {data.summary}
      </div>

      {view === "graph" ? (
        <BlastGraphView downstream={data.downstream} onViewInDiff={onViewInDiff} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.downstream.map((impact, i) => (
            <SymbolRow
              // `symbol` is a bare name, not (file, name) — two different
              // changed files can legitimately declare a same-named symbol
              // (e.g. two test files both with a local `renderWithIntl`
              // helper), so the name alone isn't a unique key.
              key={`${impact.symbol}-${i}`}
              impact={impact}
              file={symbolMeta.get(impact.symbol)?.file}
              kind={symbolMeta.get(impact.symbol)?.kind}
              onViewInDiff={onViewInDiff}
              prFilePaths={prFilePaths}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function degradedMessage(reason: string | null | undefined): string {
  switch (reason) {
    case "flag_off":
      return "Repo-intel indexing is disabled for this workspace.";
    case "index_failed":
    case "index_partial":
      return "This repo's code index hasn't finished building yet — try again after it completes.";
    case "repo_too_large":
      return "This repo is too large for a full index — the impact map may be incomplete.";
    default:
      return "This repo hasn't been indexed yet, so no impact data is available.";
  }
}

function SymbolRow({
  impact,
  file,
  kind,
  onViewInDiff,
  prFilePaths,
}: {
  impact: DownstreamImpact;
  file: string | undefined;
  kind: string | undefined;
  onViewInDiff: (file: string, line: number) => void;
  prFilePaths: Set<string>;
}) {
  const [open, setOpen] = React.useState(impact.callers.length > 0);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-surface)",
        overflow: "hidden",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          cursor: "pointer",
          color: "var(--text-primary)",
        }}
      >
        <Icon.Code size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span className="mono" style={{ fontWeight: 600, fontSize: 13.5, flexShrink: 0 }}>
          {impact.symbol}()
        </span>
        {kind && (
          <span style={{ flexShrink: 0 }}>
            <Badge bg="transparent" color="var(--text-muted)">
              {kind}
            </Badge>
          </span>
        )}
        {file && (
          <span
            className="mono"
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {file}
          </span>
        )}
        <span style={{ flex: 1, minWidth: 8 }} />
        <span style={{ fontSize: 12.5, color: "var(--text-muted)", flexShrink: 0 }}>
          {impact.callers.length} caller{impact.callers.length === 1 ? "" : "s"}
        </span>
        <Icon.ChevronDown
          size={16}
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .15s",
            color: "var(--text-muted)",
          }}
        />
      </div>

      {open && (
        <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {impact.callers.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              No known callers outside this file.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {impact.callers.map((c, i) => {
                const external = !prFilePaths.has(c.file);
                return (
                  <button
                    key={`${c.file}:${c.line}:${i}`}
                    onClick={() => onViewInDiff(c.file, c.line)}
                    title={external ? "Opens on GitHub — not part of this PR's diff" : "Jump to this line in Files changed"}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      background: "none",
                      border: "none",
                      textAlign: "left",
                      cursor: "pointer",
                      padding: "4px 0",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {external ? (
                      <Icon.Github size={13} style={{ color: "var(--ok)", flexShrink: 0 }} />
                    ) : (
                      <Icon.CornerDownRight size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    )}
                    <span
                      className="mono"
                      style={{
                        fontSize: 12.5,
                        color: "var(--link)",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.file}:{c.line}
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--text-muted)", flexShrink: 0 }}>{c.name}</span>
                  </button>
                );
              })}
            </div>
          )}
          {(impact.endpoints_affected.length > 0 || impact.crons_affected.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {impact.endpoints_affected.map((ep) => (
                <Badge key={ep} bg="var(--accent-bg)" color="var(--accent)">
                  <Icon.Globe size={11} style={{ marginRight: 4 }} />
                  {ep}
                </Badge>
              ))}
              {impact.crons_affected.map((cr) => (
                <Badge key={cr} bg="var(--warn-bg)" color="var(--warn)">
                  <Icon.Clock size={11} style={{ marginRight: 4 }} />
                  {cr}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default BlastTab;
