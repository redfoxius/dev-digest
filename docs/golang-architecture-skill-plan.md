# Golang Architecture skill — plan

**Status:** done

## What shipped

Created `~/.claude/skills/golang-architecture/` (global, outside this
repo — see Location above):

1. **`SKILL.md`** — frontmatter, positioning (stack-agnostic, complements
   any router/ORM-specific skill instead of overlapping it), a dependency
   diagram, Severity Levels, and rule sections: Package Layout, The
   Dependency Rule (Ports Declared by the Consumer), Package-Oriented
   Design, Composition Root, Error Handling as a Layering Concern, Context
   Propagation Across Ports, Testability Follows From the Rule,
   Anti-Patterns/Red Flags.
2. **`examples.md`** — a compliant `internal/orders` slice (domain →
   service → `postgres` adapter → `httpapi` adapter), the composition root
   in `cmd/api/main.go`, a Package-Oriented Design directory tree, and a
   before/after adding a hypothetical `webhooks` package — using stdlib
   `net/http`+chi and sqlc/pgx as the canonical (swappable) example stack.
3. **`README.md`** — the sources below, a section on where Go's
   consumer-declares-the-interface idiom diverges from the producer-side
   framing most Onion/Hexagonal write-ups (including this repo's own
   `onion-architecture` skill) assume, a concept-mapping table, and a "what
   this skill deliberately doesn't cover" section.

No changes to this repo's own `.claude/skills/README.md` catalog — confirmed
out of scope per the Location decision above.

## Context

Request: a new Claude Code skill, `golang-architecture`, that forces good
architectural practices onto Go backend modules — the same role
`.claude/skills/onion-architecture/` plays for this repo's TypeScript
backend (`server/`, `reviewer-core/`): own the *dependency direction and
package boundaries*, not framework mechanics.

Confirmed with the user before planning:

- **Stack scope**: generic/popular Go backend stack, not this repo's one Go
  artifact (`server/clones/redfoxius/zbc-wtf/` — a git-ignored clone of a
  third-party repo DevDigest indexes/reviews via `repo-intel`'s Go ast-grep
  support, out of scope per this repo's do-not-touch list). The skill should
  work in any Go repo, not just that one.
- **Location**: **global** — `~/.claude/skills/golang-architecture/`, not
  this repo's `.claude/skills/`. DevDigest itself has no Go code of its own,
  so nothing in the skill should reference DevDigest paths, and this repo's
  `.claude/skills/README.md` catalog does not get a new row for it.

This doc is recorded per this repo's feature-planning convention (any
plan-mode session's plan is saved to `docs/<slug>-plan.md`) even though the
skill's *files* will live outside this repo.

## Positioning (what this skill owns vs. doesn't)

Same split as `onion-architecture`/`frontend-ui-architecture`: **layering and
dependency direction**, not tool mechanics. Explicitly out of scope (a
sibling skill's job, not this one, if such skills get written later):

- Framework request/routing mechanics (Gin/Echo/Fiber/Chi handler syntax)
- ORM/query mechanics (GORM/sqlc/sqlx/pgx query-writing)
- Concurrency-pattern deep dives (goroutine/channel idioms) — touched only
  where it intersects layering (e.g. `context.Context` propagation across a
  port boundary)

## Core rules to encode

1. **Package layout** — `cmd/<app>/main.go` + `internal/` + optional `pkg/`
   (golang-standards/project-layout), framed as a guide, not a mandate:
   simplicity first, add structure when needed. Explicitly bans grab-bag
   `utils`/`common`/`models` packages.
2. **The Dependency Rule** (Clean/Hexagonal/Ports-and-Adapters, adapted to
   Go idiom) — domain/business-logic packages never import a concrete infra
   package (a DB driver, `gorm`, `redis`, a specific HTTP framework, a
   broker client) directly, only through an interface. Go inverts the usual
   OOP framing here: **ports are declared by the consumer**
   ("accept interfaces, return structs"), not pre-declared by the producer —
   the one place Go's convention differs from the TS `onion-architecture`
   skill's port style, worth calling out explicitly.
3. **Package-Oriented Design** (Ben Johnson / gobeyond.dev) as the concrete
   Go-native shape of the rule: root package = domain types with zero
   internal deps; subpackages grouped *by dependency* (`postgres/`, `http/`,
   `redis/`), not by technical layer (`controllers/`, `services/`); a shared
   `mock/` subpackage for test doubles; `main`/`cmd/` ties concrete adapters
   together.
4. **Composition root** — default to explicit manual wiring in
   `cmd/<app>/main.go` (Go's "explicit over magic" ethos, same shape as this
   repo's own `container.ts`). Escalate to `google/wire` only for
   large-but-static graphs (compile-time codegen, zero runtime cost);
   reserve `uber-go/fx` for genuinely large modular apps needing lifecycle
   hooks. A domain/service package never constructs a concrete adapter
   itself.
5. **Error handling as a layering concern** — sentinel/typed errors at
   package boundaries, `%w`-wrap with context going up the call stack,
   `errors.Is`/`errors.As` for callers matching errors, no panics crossing a
   package boundary (Uber Go Style Guide).
6. **Context propagation across ports** — `context.Context` as first param
   on any method crossing a port boundary (DB, HTTP client, adapter call) —
   the one concurrency idiom that's actually a layering rule.
7. **Testability follows from the rule** — domain-layer tests inject fakes
   satisfying the consumer-declared interface, never a real DB/HTTP server;
   table-driven tests as the default shape.

## Severity levels (same 3-tier scheme as `onion-architecture`)

- **CRITICAL** — domain/service package imports a concrete infra package
  directly (e.g. `import "gorm.io/gorm"` inside business logic); an adapter
  constructed outside the composition root.
- **HIGH** — wrong package for the logic (business rules leaking into a
  handler or a `store.go`); interface declared by the producer instead of
  the consumer; a fat `main.go` doing real business logic instead of wiring.
- **MEDIUM** — grab-bag `utils`/`common` package; a premature interface
  (single implementation, no test-double or swap need); package-by-layer
  instead of package-by-dependency organization.

## Deliverables (mirrors `onion-architecture`'s 3-file shape)

In `~/.claude/skills/golang-architecture/`:

1. **`SKILL.md`** — frontmatter (`name`, `description`, `version`), an ASCII
   dependency diagram, the Severity Levels, and a rule section per item
   above.
2. **`examples.md`** — good/bad Go snippet pairs per rule. Canonical example
   stack (generic, not zbc-wtf-specific): stdlib `net/http` + `chi` router
   for the HTTP-adapter example; `sqlc`+`pgx` for the DB-adapter example
   (GORM mentioned as the alternative for teams prioritizing velocity over
   the dependency rule's strictness). One before/after for a hypothetical
   new `internal/orders` package, matching `onion-architecture/examples.md`'s
   hypothetical-`webhooks` structure.
3. **`README.md`** — sources (below), a comparison table mapping this
   skill's terms onto canonical Clean/Hexagonal/Package-Oriented-Design
   naming, and a short "what this skill deliberately doesn't cover" section.

No changes to this repo's `.claude/skills/README.md` catalog.

## Sources to cite in README.md

- [Standard Go Project Layout (golang-standards/project-layout)](https://github.com/golang-standards/project-layout)
- [Go Project Structure 2026: Clean Architecture and Best Practices](https://reintech.io/blog/go-project-structure-2026-clean-architecture-best-practices)
- [Standard Package Layout — Ben Johnson](https://medium.com/@benbjohnson/standard-package-layout-7cdbc8391fc1) (mirror: [gobeyond.dev](https://www.gobeyond.dev/standard-package-layout/))
- [Go and a Package Focused Design — Gopher Academy](https://blog.gopheracademy.com/advent-2016/go-and-package-focused-design/)
- [Hexagonal Architecture in Golang (Ports and Adapters)](https://medium.com/@sourav.ahmed5654/a-practical-guide-to-hexagonal-architecture-in-golang-0465f53eb2a5)
- [Hexagonal Architecture in Golang: Project Structure, Example & Best Practices — GoLinuxCloud](https://www.golinuxcloud.com/hexagonal-architecture-golang/)
- [How to implement Clean Architecture in Go (Golang) — Three Dots Labs](https://threedots.tech/post/introducing-clean-architecture/)
- [Combining DDD, CQRS, and Clean Architecture in Go — Three Dots Labs](https://threedots.tech/post/ddd-cqrs-clean-architecture-combined/)
- [Wild Workouts — Go DDD/Clean Architecture/CQRS example repo](https://github.com/ThreeDotsLabs/wild-workouts-go-ddd-example)
- [Ardan Labs — service starter-kit (Domain-Driven, Data-Oriented Go services)](https://github.com/ardanlabs/service)
- [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md)
- [Go Dependency Injection Approaches — Wire vs. Fx vs Manual](https://leapcell.io/blog/go-dependency-injection-approaches-wire-vs-fx-and-manual-best-practices)
- [Compile-time DI with Go Cloud's Wire — go.dev blog](https://go.dev/blog/wire)
- [sqlc vs GORM vs sqlx: Go Database Libraries Compared 2026](https://reintech.io/blog/sqlc-vs-gorm-vs-sqlx-go-database-libraries-compared-2026)
- [Comparing database/sql, GORM, sqlx, and sqlc — JetBrains Go blog](https://blog.jetbrains.com/go/2023/04/27/comparing-db-packages/)
- [Go Chi vs Gin vs Echo: Web Framework Comparison 2026](https://reintech.io/blog/go-chi-vs-gin-vs-echo-web-framework-comparison-2026)
- [Gin vs Echo vs Fiber 2026 — Encore](https://encore.dev/articles/gin-vs-echo-vs-fiber)

## Verification

- No code/runtime changes — documentation/skill-authoring only, and the
  skill files themselves live outside this repo, so this repo's
  tests/build are unaffected.
- Every source link above was returned by a live web search performed this
  session (not recalled from training data).
- Once the skill is actually authored (follow-up step, not yet started):
  sanity-check by opening a scratch Go file with an obvious violation (e.g.
  a `service.go` importing `gorm.io/gorm` directly) in a Claude Code session
  with the global skill installed, and confirming the CRITICAL rule fires.
