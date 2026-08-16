/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION, LOW_CONFIDENCE_THRESHOLD } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  onViewInDiff,
  scrollToFindingId,
  scrollNonce,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  onViewInDiff?: (file: string, line: number) => void;
  /** An external "go to this finding" request (from the Diff tab's severity
   *  badge click) — scrolls/highlights the matching card, force-clearing
   *  "hide low confidence" first if that's what's filtering it out. Additive/
   *  no-op when omitted or when the finding isn't in this run. */
  scrollToFindingId?: string | null;
  scrollNonce?: number;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const shown = React.useMemo(() => visibleFindings(findings, hideLow), [findings, hideLow]);

  // External scroll target arrives: first, un-hide the target if "hide low
  // confidence" is what's currently filtering it out of `shown` (a state
  // change, needs its own render before the target actually exists in
  // `shown` — same two-step reasoning as FileCard's scrollToLine).
  React.useEffect(() => {
    if (!scrollToFindingId) return;
    const target = findings.find((f) => f.id === scrollToFindingId);
    if (target && hideLow && target.confidence < LOW_CONFIDENCE_THRESHOLD) setHideLow(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToFindingId, scrollNonce]);

  // ...then, once `shown` actually contains the target (immediately if it
  // wasn't hidden, or after the un-hide above re-renders), focus + scroll it.
  React.useEffect(() => {
    if (!scrollToFindingId) return;
    const idx = shown.findIndex((f) => f.id === scrollToFindingId);
    if (idx === -1) return; // not in this run's findings — no-op, no crash
    setFocusIdx(idx);
    const el = listRef.current?.querySelector(`[data-finding-id="${scrollToFindingId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToFindingId, scrollNonce, shown]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list} ref={listRef}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
              onViewInDiff={onViewInDiff}
            />
          ))
        )}
      </div>
    </div>
  );
}
