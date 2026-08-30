import { EvalDashboardListView } from "./_components/EvalDashboardListView";

/* Route: /eval-dashboard (Eval Dashboard — spec §6.10, plan Work Item 13).
   Thin route entry — the view, its per-agent rows, styles and i18n are
   colocated under _components/EvalDashboardListView, mirroring
   /agents/page.tsx's own "thin entry + self-fetching view" shape. */
export default function EvalDashboardPage() {
  return <EvalDashboardListView />;
}
