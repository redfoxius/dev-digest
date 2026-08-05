# INSIGHTS — reviewer-core

Practical findings hit while working in this module. Append-only: correct a
stale entry with a new dated line, never edit or delete history silently.

Before writing here, check [AGENTS.md](AGENTS.md) — a finding that should
*always* apply belongs there as a standing rule; this file is for things too
specific, too contextual, or too unproven for that yet.

**Anti-vague test:** if someone who just read the code wouldn't be surprised,
don't write it. See the repo's `engineering-insights` skill for the full
workflow and quality bar.

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

- 2026-08-05 — `OpenRouterProvider`'s constructor passes `timeout: 90_000` to
  the `openai` SDK client, and the class's own docstring claims "request
  timeouts" live in this one place — but that constructor-level `timeout`
  turned out NOT reliably enforced in practice: a real review against a real
  ~30-file PR hung 8+ minutes with zero error, well past the documented
  90s×maxRetries(2) worst case (~4.5 min). Root cause unconfirmed (SDK/fetch
  edge case, not reproduced in a hermetic test — the hang only showed up
  against the real network). Fix: pass an explicit `{ signal:
  AbortSignal.timeout(timeoutMs) }` as the 2nd arg to
  `chat.completions.create()`, per-attempt — a standard, independently
  enforced abort mechanism, not dependent on whatever the SDK does
  internally with its own `timeout` option.
  (`src/llm/openrouter.ts:68-92`)

## Recurring Errors & Fixes

## Open Questions

## Session Notes
