---
name: onion-architecture
description: "Forces the Onion/Ports-and-Adapters dependency rule for backend code in server/ and reviewer-core/: dependencies point inward only, business logic never imports infrastructure (Drizzle, Fastify, Octokit, LLM SDKs) directly, and every external dependency crosses a port interface wired in one composition root. Use when adding a new backend module, adding a new external integration/adapter, reviewing a service/route/repository for layering violations, or deciding where new backend logic belongs. Architecture and dependency direction only — NOT Fastify request-lifecycle mechanics (see fastify-best-practices) and NOT Drizzle query/schema mechanics (see drizzle-orm-patterns)."
version: "1.1.0"
---

# Onion Architecture (Backend)

Where backend dependencies are allowed to point, and who's allowed to import
what. Complements the two sibling backend skills instead of overlapping them:

- **`fastify-best-practices`** owns HTTP *mechanics* — plugins, hooks,
  validation, serialization.
- **`drizzle-orm-patterns`** owns query *mechanics* — schema, relations,
  transactions.
- **This skill** owns *the dependency rule* — which ring a piece of code
  belongs in, and what it's forbidden to import.

`server/` already grew this shape organically: one plugin per domain
(`modules/<name>/routes.ts` + `service.ts` + `repository.ts`), a
composition-root DI container (`platform/container.ts`), and adapters behind
port interfaces (`adapters/*`, typed in `vendor/shared`). `reviewer-core/` is
the innermost ring done in its purest form — no DB/FS/network at all, the
only side effect an injected `LLMProvider`. This skill names that shape and
gives it teeth for new code. For code examples, see
[examples.md](examples.md). For sources and how this repo's shape compares to
canonical Onion/Hexagonal/Clean, see [README.md](README.md).

## The Rings

```
   ┌─────────────────────────────────────────────┐
   │ Infrastructure  (adapters/*, external SDKs)  │
   │  ┌───────────────────────────────────────┐  │
   │  │ Interface adapters (routes.ts,          │  │
   │  │  repository.ts / repository/*.repo.ts)  │  │
   │  │  ┌─────────────────────────────────┐  │  │
   │  │  │ Application (service.ts)          │  │  │
   │  │  │  ┌───────────────────────────┐  │  │  │
   │  │  │  │ Domain (reviewer-core)      │  │  │  │
   │  │  │  └───────────────────────────┘  │  │  │
   │  │  └─────────────────────────────────┘  │  │
   │  └───────────────────────────────────────┘  │
   └─────────────────────────────────────────────┘
        dependencies point INWARD only  →
```

- **Domain** — `reviewer-core/`: pure business rules (prompt assembly,
  grounding, scoring). No DB/FS/network; its only side effect is an injected
  `LLMProvider` port.
- **Application** — `modules/<name>/service.ts`: use-case orchestration.
  Depends on port *types* (`GitHubClient`, `LLMProvider`, repository classes)
  and on `reviewer-core`, never on a concrete adapter or `drizzle-orm`.
- **Interface adapters** — `routes.ts` (HTTP in/out, zod validation) and
  `repository.ts` / `repository/*.repo.ts` (the only files allowed to import
  Drizzle for that domain).
- **Infrastructure** — `adapters/*` (`OctokitGitHubClient`, `SimpleGitClient`,
  `OpenAIProvider`, …) and the composition root, `platform/container.ts`,
  which is the only place a concrete adapter gets constructed.

## Severity Levels

- **CRITICAL** — breaks the dependency rule; couples business logic to a
  specific infrastructure choice, or bypasses the composition root
- **HIGH** — wrong layer for logic, or skips the module's routes → service →
  repository shape
- **MEDIUM** — organizational polish; wrong today, cheap to fix later

---

## The Dependency Rule (CRITICAL)

- Dependencies point inward only. `service.ts` and `reviewer-core` must never
  import `drizzle-orm`, `postgres`, `fastify`, `octokit`, `simple-git`,
  `openai`, or `@anthropic-ai/sdk` directly — only through a port interface
  (`LLMProvider`, `GitHubClient`, `GitClient`, `CodeIndex`, `Embedder`,
  `AuthProvider`, `SecretsProvider` — all defined in
  `server/src/vendor/shared/adapters.ts`).
- A service takes ports as constructor/method dependencies (usually via
  `Container`, see **Composition Root** below), and calls their interface
  methods — it never knows which concrete class is behind them.
- If you catch yourself writing `import { eq } from 'drizzle-orm'` or
  `import type { FastifyRequest }` inside a `service.ts`, that's the rule
  breaking — the fix is always to push the concern one ring outward (into
  `repository.ts` or `routes.ts`), not to special-case it.

## Ports & Adapters (CRITICAL)

- A new external dependency (a new SaaS API, a new LLM provider, a new VCS
  operation) gets: an interface added to `server/src/vendor/shared/adapters.ts`
  (or extended on an existing one) **+** a concrete implementation under
  `server/src/adapters/<name>/` **+** wiring in `platform/container.ts`. No
  other file constructs it.
- Existing ports to model a new one on: `LLMProvider` → `OpenAIProvider` /
  `AnthropicProvider` / `OpenRouterProvider`; `GitHubClient` →
  `OctokitGitHubClient`; `GitClient` → `SimpleGitClient`; `CodeIndex` →
  `RipgrepCodeIndex`.
- Tests never import a concrete adapter to stub it — they inject a fake via
  `ContainerOverrides` (`server/src/adapters/mocks.ts` holds the shared fakes:
  `MockLLMProvider`, `MockGitClient`, …).

## Module Anatomy — routes → service → repository (HIGH)

Every `modules/<name>/` plugin keeps this one-way call chain (worked example:
`modules/reviews/{routes,service,repository}.ts`):

1. **`routes.ts`** — Fastify plugin. Zod `params`/`body` schemas via
   `fastify-type-provider-zod` validate the request before the handler runs;
   the handler itself does nothing but call the service and shape the
   response. No business logic, no direct DB access.
2. **`service.ts`** — the application layer. Orchestrates the use case
   (e.g. `ReviewService.runReview`), calling repository methods and port
   interfaces obtained from `Container`. This is where business rules that
   aren't pure enough for `reviewer-core` live.
3. **`repository.ts`** (or `repository/*.repo.ts` split by aggregate, as in
   `modules/reviews/repository/{review,run,pull}.repo.ts`) — the *only* file
   in the module allowed to import `drizzle-orm` / `../../db/schema.js`.
   Returns domain-shaped rows/DTOs, not raw query builders, to the service.

A route calling `db.select()` directly, or a service with inline SQL, both
skip a layer — split it back into the three files above.

## Composition Root (CRITICAL)

- `platform/container.ts` is the single place where concrete adapters get
  constructed (`new OctokitGitHubClient(token)`, `new SimpleGitClient(dir)`,
  `new OpenAIProvider(key)`, …) and exposed as typed getters
  (`container.git`, `container.codeIndex`, `container.agentsRepo`, …).
- Nothing outside `container.ts` should ever write `new <SomeAdapter>()`. A
  module needing a new capability adds a getter to `Container`, not a local
  instantiation.
- `ContainerOverrides` is the sanctioned override seam for tests — swap
  `secrets`, `auth`, `github`, `git`, `codeIndex`, `embedder`, `llm`,
  `repoIntel`, `depgraph`, `tokenizer` without touching the constructor logic.
- Cross-module shared repositories (`agentsRepo`, `reviewRepo`) are held on
  the container too, precisely so a service uses
  `container.agentsRepo` instead of reaching into another module's
  `repository.ts` file directly (see the comment above `_agentsRepo` in
  `container.ts`).

## Domain Purity — the reviewer-core reference (CRITICAL)

`reviewer-core/src/review/run.ts`'s `reviewPullRequest()` is the canonical
worked example of the innermost ring:

- Signature takes `diff`, `systemPrompt`, `model`, and an injected `llm:
  LLMProvider` — **no** `Db`, no `fetch`, no filesystem.
- `reviewer-core`'s own `AGENTS.md` states the rule explicitly: "Never add
  DB/GitHub/FS calls here" — because the server is this package's only
  consumer *precisely because* it's side-effect-free and mock-testable.
- Consumed as TypeScript **source** via a tsconfig path alias, not a built
  package — so there's no publish step tempting anyone to bundle I/O into a
  "just this once" release.
- New pure business-rule logic (scoring, grounding, prompt shaping) belongs
  here, not in `server/src/modules/*/service.ts`, if it can be expressed with
  zero I/O beyond an injected provider.

## Filesystem Ownership Per Module (HIGH)

- Within a `modules/<name>/` plugin, filesystem access to a project's cloned
  working tree (reading files, walking directories) is owned by exactly one
  designated file, the same way `repository.ts` is the only file allowed to
  import `drizzle-orm` for that domain. For `context-docs`, that file is
  `reader.ts` (`discoverContextDocs`, the only place `node:fs`/
  `node:fs/promises` is imported for that module).
- `service.ts` orchestrates the use case and calls into the module's
  FS-owning file — it never imports `node:fs`/`node:fs/promises`/`node:path`
  to read repo content itself, even for a "just this once" or debug-only
  read. Treat that exactly like `service.ts` importing `drizzle-orm`
  directly: push the read into the designated reader/repository file
  instead of inlining it, regardless of how the change is described.

## Contracts as the Cross-Ring Language (HIGH)

- `server/src/vendor/shared/contracts/*` zod schemas (and their hand-copied
  twin in `client/src/vendor/shared` — see root `AGENTS.md`) are the DTOs
  that cross every ring boundary: route response shapes, service return
  types, SSE event payloads.
- A Drizzle-inferred row type (`typeof t.reviews.$inferSelect`) must not leak
  past `repository.ts` — `repository.ts` maps rows to a DTO shape (or the
  service does, via a `helpers.ts` converter like `reviews/helpers.ts`'s
  `reviewToDto`) before it reaches `routes.ts`.
- This is what lets the repository's storage details change (a column
  rename, a join restructure) without touching the route or its response
  contract.

## Testability Follows From the Rule (HIGH)

- Because services depend on port *interfaces*, unit tests
  (`pnpm exec vitest run --exclude '**/*.it.test.ts'`) construct a
  `Container` with `ContainerOverrides` pointing at
  `src/adapters/mocks.ts` fakes — no Docker, no real Postgres, no network.
- Only `*.it.test.ts` files exercise a real adapter (real Postgres via
  `testcontainers`) — that suffix is the enforcement seam for the
  unit/integration split (see `server/AGENTS.md`'s Gotchas).
- If a new unit test needs to spin up Postgres or hit a real API, that's a
  signal the code under test reached past its port — not a signal to add a
  Docker dependency to the "unit" run.

## Anti-Patterns / Red Flags (CRITICAL)

Treat any of these as a layering violation to fix, not a style nit:

- `import ... from 'drizzle-orm'` or `'postgres'` inside a `service.ts`.
- `import type { FastifyRequest, FastifyReply }` anywhere outside
  `routes.ts` (or `_shared/context.ts` helpers routes call into).
- `new OctokitGitHubClient(...)`, `new OpenAIProvider(...)`, or any other
  concrete adapter construction outside `platform/container.ts`.
- A route handler with an `if`/business calculation beyond shaping the
  response — that belongs in `service.ts`.
- A service importing another module's `repository.ts` directly (e.g.
  `pulls/service.ts` importing `reviews/repository.ts`) instead of going
  through the container's shared repo getter.
- Reviewer/business logic added to `server/src/modules/reviews/*` that has
  no DB/HTTP dependency at all — check first whether it belongs in
  `reviewer-core` instead, so the CI runner can reuse it too.
