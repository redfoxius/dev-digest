# Workflow Retro Ledger

One row per `/workflow-retro` run, so runs can be compared over time.

| date | label | agents | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|--------|-----------|-----------|------|-------------|------|--------------------|
| 2026-08-19 | pr-self-review-pr20-match | 2 (1 wasted) | 26→2522 | 84% | 106s | 0.35x (2 sequential launches, not true concurrency) | ~$0.26 (est., intro Sonnet 5 rates + standard cache multipliers) | Verify `Workflow` `args` actually hold real content before firing — a placeholder-string launch cost ~$0.07 and a `TaskStop` for zero output |
