"use client";

import React from "react";
import type { DownstreamImpact } from "@devdigest/shared";

interface BlastGraphViewProps {
  downstream: DownstreamImpact[];
  onViewInDiff: (file: string, line: number) => void;
}

const MAX_SYMBOL_NODES = 10;
const MAX_CALLER_NODES = 20;
const ROW_HEIGHT = 34;
const SYMBOL_X = 40;
const CALLER_X = 420;
const NODE_WIDTH = 220;
const TOP_PAD = 20;

/**
 * Minimal bipartite graph view (symbol nodes ↔ caller-file nodes, edges =
 * "this file calls this symbol") — the mockup's "Graph" toggle alongside
 * the existing Tree list (BlastTab.tsx). Deterministic two-column layout,
 * no graph-layout library: symbols with the most callers are the ones worth
 * seeing as a graph, so both node sets are capped and callers deduped by
 * file (one file can call several changed symbols — one node, several edges).
 */
export function BlastGraphView({ downstream, onViewInDiff }: BlastGraphViewProps) {
  const withCallers = downstream.filter((d) => d.callers.length > 0);
  const symbols = [...withCallers]
    .sort((a, b) => b.callers.length - a.callers.length)
    .slice(0, MAX_SYMBOL_NODES);

  if (symbols.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "24px 0", textAlign: "center" }}>
        No callers to graph yet.
      </div>
    );
  }

  // Caller nodes = unique files, in first-seen order across the shown symbols.
  const callerFiles: string[] = [];
  const callerLineByFile = new Map<string, number>();
  for (const s of symbols) {
    for (const c of s.callers) {
      if (!callerLineByFile.has(c.file)) {
        callerFiles.push(c.file);
        callerLineByFile.set(c.file, c.line);
      }
    }
  }
  const truncatedCallers = callerFiles.length > MAX_CALLER_NODES;
  const shownCallerFiles = callerFiles.slice(0, MAX_CALLER_NODES);
  const callerIndex = new Map(shownCallerFiles.map((f, i) => [f, i]));

  const height = TOP_PAD * 2 + Math.max(symbols.length, shownCallerFiles.length) * ROW_HEIGHT;
  const width = CALLER_X + NODE_WIDTH + 20;

  const symbolY = (i: number) => TOP_PAD + i * ROW_HEIGHT + ROW_HEIGHT / 2;
  const callerY = (i: number) => TOP_PAD + i * ROW_HEIGHT + ROW_HEIGHT / 2;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ maxWidth: width, display: "block" }}
        role="img"
        aria-label="Blast radius graph: caller files on the left, changed symbols on the right"
      >
        {symbols.map((s, si) =>
          s.callers
            .filter((c) => callerIndex.has(c.file))
            .map((c, ci) => (
              <line
                key={`${si}-${s.symbol}-${c.file}-${ci}`}
                x1={CALLER_X}
                y1={callerY(callerIndex.get(c.file)!)}
                x2={SYMBOL_X + NODE_WIDTH}
                y2={symbolY(si)}
                stroke="var(--border)"
                strokeWidth={1}
              />
            )),
        )}

        {shownCallerFiles.map((file, i) => (
          <g
            key={file}
            transform={`translate(${CALLER_X}, ${callerY(i) - 12})`}
            style={{ cursor: "pointer" }}
            onClick={() => onViewInDiff(file, callerLineByFile.get(file) ?? 1)}
          >
            <rect
              width={NODE_WIDTH}
              height={24}
              rx={6}
              fill="var(--bg-elevated)"
              stroke="var(--border)"
            />
            <text x={8} y={16} fontSize={11} fontFamily="monospace" fill="var(--text-secondary)">
              {truncateMiddle(file, 30)}
            </text>
          </g>
        ))}

        {symbols.map((s, i) => (
          // Same non-uniqueness caveat as BlastTab's SymbolRow list — `symbol`
          // is a bare name, not (file, name).
          <g key={`${s.symbol}-${i}`} transform={`translate(${SYMBOL_X}, ${symbolY(i) - 12})`}>
            <rect
              width={NODE_WIDTH}
              height={24}
              rx={6}
              fill="var(--bg-surface)"
              stroke="var(--accent)"
              strokeWidth={1.5}
            />
            <text x={8} y={16} fontSize={11} fontFamily="monospace" fontWeight={600} fill="var(--text-primary)">
              {s.symbol}() · {s.callers.length}
            </text>
          </g>
        ))}
      </svg>

      {(withCallers.length > symbols.length || truncatedCallers) && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
          Showing top {symbols.length} of {withCallers.length} symbols with callers
          {truncatedCallers ? ` and ${MAX_CALLER_NODES} of ${callerFiles.length} caller files` : ""} — switch to
          Tree for the full list.
        </div>
      )}
    </div>
  );
}

function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(s.length - half)}`;
}

export default BlastGraphView;
