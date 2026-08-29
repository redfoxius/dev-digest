#!/usr/bin/env bash
#
# DevDigest Lesson 06 verification gate — the single command that proves
# server+client typecheck and unit tests are green.
#
#   pnpm verify:l06        # from the repo root
#   ./scripts/verify-l06.sh
#
# Runs, in order, failing fast on the first non-zero exit:
#   1. server typecheck
#   2. server unit tests (excludes *.it.test.ts — those need Docker/
#      testcontainers, see server/AGENTS.md's documented unit/integration split)
#   3. client typecheck
#   4. client tests
#
# `reviewer-core` is intentionally NOT part of this gate — this lesson's
# feature only consumes `reviewPullRequest`/`groundFindings` as they already
# exist there, unmodified (spec's own Clarification row 4 reasoning).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

log "server: typecheck"
(cd server && pnpm typecheck)

log "server: unit tests (excludes *.it.test.ts)"
(cd server && pnpm exec vitest run --exclude '**/*.it.test.ts')

log "client: typecheck"
(cd client && pnpm typecheck)

log "client: tests"
(cd client && pnpm test)

log "verify:l06 passed"
