# Conventions Extractor — finding-quality plan

**Status:** not started.

## Context

Prompted by a debugging session on `feat/agent-skills` (branch `lesson_2_fixes`,
PR #11) that fixed several UX bugs in the "Create skill from conventions"
flow, but didn't touch what the Extractor actually *finds* — whether the
candidate rules it proposes are good ones. This plan is about that: how to
measure the quality of Conventions Extractor findings today, and where to
improve it once the weak spots are known.

See [conventions-extractor-plan.md](conventions-extractor-plan.md) for the
feature's original build plan (status: code complete) — this plan doesn't
redo that scoping, only adds a quality layer on top.

**No eval harness exists on this branch.** A statistics-grade one does exist
on other lesson branches in this repo (`feat(evals): statistics-grade harness
eval package`, `feat(evals): OpenRouter engine`, etc. — see `git log --all
--oneline | grep eval`), but hasn't been merged here. Phase 1 below is
deliberately scoped to not need it; pulling that harness in is a fork in the
road called out in Open Questions, not a prerequisite.

## What the Extractor does today (grounding for this plan)

- `server/src/modules/conventions/service.ts`'s `extract()` runs two
  candidate pools per scan: `origin: 'config'` (deterministic parsers over
  eslint/tsconfig/prettier-shaped files, `confidence: 1`, lands as
  `status: 'accepted'` automatically — no human review) and `origin: 'model'`
  (a cheap-model pass over top-ranked sample files, lands as
  `status: 'pending'` — always needs a human accept/reject).
- Every model-origin candidate's `evidence_snippet` is verified against the
  actual cloned file before it's ever persisted
  (`helpers.ts`'s `findEvidenceLineRange`): exact line match first, then a
  fuzzy sliding-window match (`EVIDENCE_FUZZY_THRESHOLD`). No match at all →
  discarded pre-persistence, never reaches a human. The rule/category text
  itself is never verified — only the evidence snippet's presence in the file.
- Dedup (`repository.ts`'s `dedupKey`) is `rule.trim().toLowerCase() +
  '::' + evidencePath.trim().toLowerCase()` — an exact string match. Two
  candidates that restate the same rule in different words on the same file
  do **not** dedupe against each other.
- `confidence` is whatever the model self-reports (or `1` for config-origin);
  nothing today checks it against real outcomes.

## Phase 1 — Verify (cheap, no new infrastructure)

1. **Mine the acceptance data already being collected.** Every candidate
   carries `status` (accepted/rejected/pending) and `origin` (config/model).
   A report of accept-rate by `origin` × `category` needs no new
   instrumentation — the data already lives in the `conventions` table. Since
   config-origin auto-accepts, the *human* reject-rate on model-origin
   candidates is the real precision signal today.
2. **A small hand-graded eval set.** Pick 2–3 real repos with conventions you
   can enumerate by hand ahead of time, run extraction, diff the output
   against that ground truth for precision/recall per category. Can start as
   a fixture-based test alongside the existing pattern in
   `server/test/conventions.it.test.ts`, without needing a full eval harness.
3. **Audit the exact-vs-fuzzy match ratio.** A fuzzy-matched candidate means
   the model's cited snippet didn't literally match the file — a real,
   already-computed signal (`findEvidenceLineRange`'s two-pass logic) that's
   currently discarded rather than recorded. Logging which path matched costs
   nothing and lets Phase 1's report check whether fuzzy-matched candidates
   correlate with human rejects.

## Phase 2 — Improve (once Phase 1 shows where it's weak)

4. **Near-duplicate dedup.** `dedupKey()`'s literal string match misses
   differently-worded restatements of the same rule on the same file.
   `helpers.ts` already has `lineSimilarity()` (used today only for evidence
   fuzzy-matching) — reusing it for rule-text similarity is a small, targeted
   fix once Phase 1 confirms duplicates are actually a meaningful share of
   noise.
5. **Confidence calibration.** Once Phase 1.1 gives real accept/reject
   outcomes, correlate them against self-reported `confidence` — if it isn't
   predictive of what a human actually accepts, it isn't safe to use for any
   future auto-accept threshold.
6. **Regression-guard prompt/model changes.** Once Phase 1.2's eval set
   exists, any future change to the extraction prompt or the cheap-model
   choice gets checked against it before shipping, catching precision
   regressions instead of finding them live in a user's repo.

## Open questions

- Pull in the other branches' eval harness now, or build Phase 1's report as
  a standalone script first and reconsider once it's clear what shape of
  harness this actually needs?
- Where should the accept-rate report live — an ad-hoc script, a route the
  Skills Lab UI surfaces, or a one-off notebook-style check run manually per
  repo? Not decided; depends on how often this needs re-running.
- Phase 1.2's ground-truth repos: reuse the same seeded demo repos already in
  `server/src/db/seed.ts`, or pick fresh ones specifically because their real
  conventions are already well understood?
