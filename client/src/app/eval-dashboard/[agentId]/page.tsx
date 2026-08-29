"use client";

import { useParams } from "next/navigation";
import { EvalDashboardDrilldown } from "./_components/EvalDashboardDrilldown";

/* Route: /eval-dashboard/:agentId (per-agent Eval Dashboard drilldown —
   spec §6.10 AC-34, plan Work Item 13). Thin route entry — extracts the
   route param, the view is self-fetching and colocated under
   _components/EvalDashboardDrilldown. */
export default function EvalDashboardDrilldownPage() {
  const params = useParams<{ agentId: string }>();
  return <EvalDashboardDrilldown agentId={params.agentId} />;
}
