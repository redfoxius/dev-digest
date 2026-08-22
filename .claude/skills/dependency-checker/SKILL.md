---
name: dependency-checker
description: "Audits dependencies across this repo's standalone packages (server, client, reviewer-core, e2e, mcp-server, evals) — external npm packages, internal cross-package coupling (path aliases, hand-copied vendor/shared twins), installed size, version drift, and unused packages — and produces one structured report: Scope, a Mermaid dependency graph, a size breakdown table, severity-tiered findings (P0/P1/P2/Info), and a prioritized summary of concrete next actions. Use when asked to audit/check dependencies, investigate bloat or install size, look for unused or duplicated packages, check for version drift across packages, or before adding a new dependency to see what already exists. NOT a CVE/security audit (see the `security` skill) and NOT package-manager command mechanics (pnpm vs npm install/add syntax)."
version: "1.0.0"
---

# Dependency Checker

Answers "what do we depend on, how much does it cost, and what should we do
about it" for a repo that is deliberately **not** a monorepo. Root
`CLAUDE.md`: 5 standalone packages plus `evals/`, no workspace tool (no pnpm
workspaces, no Turborepo) — `pnpm` for `server/`+`client`/`evals`, `npm` for
`reviewer-core/`+`e2e/`+`mcp-server/`, and cross-package types via **tsconfig
path aliases**, never a published/`workspace:*` package. Every check below
exists because that shape produces failure modes a normal monorepo dependency
auditor never sees. For a full worked example end-to-end, see
[examples.md](examples.md).

## Severity Tiers

- **P0** — an internal boundary is broken by a dependency-shaped shortcut:
  a package reaching into another package's `src/` by relative import
  instead of its intended path (HTTP call, public entry point, path alias),
  or a claim that this repo uses `workspace:*`/a shared install when it
  doesn't.
- **P1** — real, measurable cost: a heavy dependency with zero matching
  imports (dead weight), or version drift on a package whose *shape* crosses
  a package boundary (e.g. `zod`, whose schemas are the DTO contract between
  `server/` and `client/`).
- **P2** — organizational/cleanup: two packages doing overlapping jobs,
  minor version drift on a dependency that doesn't cross a boundary,
  disk cost from the no-workspace shape multiplying installs.
- **Info** — worth knowing, not worth acting on today (an intentional
  duplication called out in `CLAUDE.md`, a large but clearly load-bearing
  dependency).

---

## Scope — Enumerating the Packages (CRITICAL, do this first)

- The unit of analysis is a **package with its own `package.json`**:
  `server/`, `client/`, `reviewer-core/`, `e2e/`, `mcp-server/`, `evals/` as
  of this writing — confirm the current list yourself
  (`find . -maxdepth 2 -name package.json -not -path '*/node_modules/*'`)
  rather than trusting this list, since a new package can be added later.
- Record each package's declared name (`"name"` field) and package manager
  (pnpm: `pnpm-lock.yaml` present; npm: `package-lock.json` present) — this
  becomes the report's **Scope** section, and the package-manager split is
  itself worth stating since a `pnpm add` in an npm-managed package is a
  common mistake here.
- `server/clones/*` (git-ignored working checkouts of indexed repos, per
  root `CLAUDE.md`) is never part of this repo's own dependency graph —
  don't walk into it even if it contains its own `package.json` files.

## Gathering the Data

1. **Declared dependencies** — read every package's `package.json`
   (`dependencies` + `devDependencies`, and `engines`/`packageManager` if
   present). A dependency's *declared* version range is not its *resolved*
   version — cross-check the lockfile (`pnpm-lock.yaml` / `package-lock.json`)
   when a drift finding needs the exact installed version, not just the range.
2. **Installed size** — `du -sh <pkg>/node_modules/<name>`. **Gotcha:**
   pnpm-managed packages (`server/`, `client/`, `evals/`) store packages as
   symlinks into a content-addressed store — a plain `du -sh` on the
   symlink reports a few bytes, not the real size. Use `du -shL` (dereference
   symlinks) for any pnpm-managed package; npm-managed packages
   (`reviewer-core/`, `e2e/`, `mcp-server/`) have real copies and don't need
   `-L`. Report only what's actionable — the top offenders, anything flagged
   in a finding — never a dump of every entry in `node_modules`.
3. **Internal (cross-package) dependencies** — these never appear in
   `package.json`, so `npm ls`/`pnpm why` can't see them. Find them by:
   - grepping each package's `src/` for relative imports that climb two or
     more directories out of the package (a `from "../../"`-style import),
     the tsconfig `paths` entries that make that resolve, and any
     `server/src/vendor/shared` ↔
     `client/src/vendor/shared` pair (hand-copied contract twins per root
     `CLAUDE.md` — treat drift between the two copies as its own finding
     type, not noise).
   - checking how `mcp-server/` reaches `server/` — it's documented to talk
     over HTTP only; a direct import of `server/src/**` from `mcp-server/`
     is a P0 (see `onion-architecture`'s composition-root rule for the same
     shape applied to a single service).
   - never describe any of this as `workspace:*`, a pnpm workspace, or a
     shared `node_modules` — this repo has none of those.
4. **Version drift** — same package name, different resolved version across
   packages. Diff the lockfiles or `package.json` ranges directly; don't
   estimate. Severity depends on what the package *is*: drift on a
   contract-shaping library (`zod`) or a test/build tool with behavior
   differences across majors (e.g. a `vitest` v2 vs v4 split) outranks drift
   on an interchangeable dev tool.
5. **Unused dependencies** — a package.json entry with zero matches when
   grepping that package's `src/` (or root config files it might apply to)
   for the import name. State the exact grep you ran when you report one —
   "found no import of X anywhere under `<pkg>/src`" — never assert unused
   without having actually searched.
6. **Duplicate-purpose packages** — two dependencies solving the same
   problem (e.g. two date libraries) either within one package or across the
   repo's shape (e.g. every one of the 6 packages independently declaring
   `typescript`/`@types/node`/a test runner — expected here since there's no
   workspace to hoist them, but still worth naming as the disk-cost trade-off
   that comes with this repo's explicit no-workspace choice).

## Report Structure (produce exactly these 5 sections, in order)

1. **Scope** — the packages analyzed (name, directory, package manager), and
   anything explicitly excluded and why.
2. **Dependency Graph** — one ```mermaid flowchart``` at package granularity:
   a node per package, an edge per real coupling you found in step 3 above,
   labeled with *how* it couples (`tsconfig path alias`, `HTTP only`,
   `hand-copied twin`) — never an unlabeled arrow, and never an edge implying
   an npm/workspace dependency that doesn't exist.
3. **Size Breakdown** — a table (package, dependency, installed size,
   prod/dev) sorted by size descending, capped to a reasonable top N with an
   explicit note of how many rows were omitted.
4. **Findings & Priorities** — grouped under explicit `P0`/`P1`/`P2`/`Info`
   headers. Every finding names a specific package + dependency (or file) —
   never generic advice like "consider auditing dependencies."
5. **Summary** — 3–5 concrete, priority-ordered next actions, phrased as
   recommendations for the user to confirm (e.g. "consider removing X from
   Y") — never phrased as something already done.

## Anti-Patterns / Red Flags

- Calling this a pnpm/npm workspace, monorepo, or saying a fix should
  "hoist via `workspace:*`" — none of those exist here.
- Treating `server/src/vendor/shared` and `client/src/vendor/shared` as one
  copy — they're independently edited; report drift between them.
- A size table with a plain (non-`-L`) `du -sh` result for a pnpm-managed
  package — re-measure with `-shL`.
- Asserting a dependency is unused without citing the grep that found
  nothing.
- Skipping straight to "Findings" without an explicit **Scope** — a reader
  can't tell what wasn't checked.
- Recommending a removal/upgrade as if it were already applied, instead of
  as a recommendation.
