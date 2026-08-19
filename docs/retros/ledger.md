# Workflow Retro Ledger

One row per `/workflow-retro` run, so runs can be compared over time.

| date | label | agents | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|--------|-----------|-----------|------|-------------|------|--------------------|
| 2026-08-19 | pr-self-review-pr20-match | 2 (1 wasted) | 26→2522 | 84% | 106s | 0.35x (2 sequential launches, not true concurrency) | ~$0.26 (est., intro Sonnet 5 rates + standard cache multipliers) | Verify `Workflow` `args` actually hold real content before firing — a placeholder-string launch cost ~$0.07 and a `TaskStop` for zero output |
| 2026-08-19 | run-plan-project-context-folder | 11 (7 done, 4 failed@session-limit) | n/a→n/a (942,924 tok total, successful agents only — no in/out split in-context) | n/a | ~18.8min (Wave A+B wall-clock; Wave C interrupted) | 2.28x (Wave A+B) | n/a (no in/out split to price) | Spec §10 never stated how a workspace-scoped resource's repo-scoped sub-endpoint carries the repo id — 2 backend agents (WI8/WI9) each independently invented `?repo_id=`, and the already-finished consumer (WI12 client hooks) shipped without it, forcing a manual 6-edit orchestrator patch after the fact |
