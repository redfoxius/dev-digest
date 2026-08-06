# Sources & Rationale

## What Onion Architecture is

Coined by Jeffrey Palermo: concentric layers where dependencies only point
inward, the domain model sits at the center with zero knowledge of
infrastructure, and outer layers (UI, DB, external services) depend on the
core through interfaces — never the reverse. It's one of a family of
"dependency-inversion-first" styles alongside **Hexagonal / Ports and
Adapters** (Alistair Cockburn) and **Clean Architecture** (Robert C. Martin)
— all three enforce the same core rule (dependencies point inward / toward
the domain) with different naming for the layers and boundary mechanism.

- [Understanding Onion Architecture: A Clean Approach to Software Design](https://medium.com/lets-code-future/understanding-onion-architecture-a-clean-approach-to-software-design-f41af77b72d8) — layer/dependency-rule walkthrough.
- [Mastering Onion Architecture](https://www.numberanalytics.com/blog/mastering-onion-architecture) and [Onion Architecture in Practice](https://www.numberanalytics.com/blog/onion-architecture-in-practice) — best-practices framing: domain-model independence, dependency inversion via DI, layers communicating exclusively through abstractions.
- [Onion Architecture in Software Development](https://codefinity.com/blog/Onion-Architecture-in-Software-Development) — layer-by-layer reference (Domain → Application → Infrastructure → Presentation).
- [Ports and Adapters (Hexagonal Architecture) — Software Architecture Wiki](https://synchronium.github.io/software-architecture-wiki/styles/ports-and-adapters.html) — the "port = interface, adapter = implementation" terminology this skill borrows directly (`GitHubClient` is a port, `OctokitGitHubClient` is its adapter).
- [Hexagonal Architecture (Ports and Adapters): A Complete Guide with a TypeScript Example](https://generalistprogrammer.com/tutorials/hexagonal-architecture-complete-guide) and [Clean Architecture: A Complete Guide to Layers, the Dependency Rule, and How It Compares to Onion and Hexagonal](https://generalistprogrammer.com/tutorials/clean-architecture-complete-guide) — direct comparison of the three styles; useful background for *why* this repo's shape (below) doesn't map 1:1 onto any single canonical diagram.

## Node.js / TypeScript-specific implementation guidance

- [Clean Node.js Architecture — Khalil Stemmler](https://khalilstemmler.com/articles/enterprise-typescript-nodejs/clean-nodejs-architecture/) — the most widely cited reference for layered TypeScript backends; source for the "services depend on interfaces, composition root wires concrete classes" pattern this skill applies to `platform/container.ts`.
- [Onion Architecture in Node.js with TypeScript](https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391) — worked Express+TS example of the same four rings.
- [Implementing SOLID and the Onion Architecture in Node.js with TypeScript and InversifyJS](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad) — DI-container-centric implementation; this repo's `Container` class plays the same role InversifyJS plays there, just hand-rolled instead of a DI framework.

## How this repo's shape maps to (and diverges from) the canonical pattern

| Canonical concept | This repo |
|---|---|
| Domain layer | `reviewer-core/` (zero I/O, injected `LLMProvider`) |
| Application layer | `modules/<name>/service.ts` |
| Interface adapters | `modules/<name>/routes.ts` + `repository.ts` |
| Infrastructure / frameworks | `adapters/*`, Fastify, Drizzle, external SDKs |
| Ports | interfaces in `vendor/shared/adapters.ts` (`LLMProvider`, `GitHubClient`, `GitClient`, `CodeIndex`, `Embedder`, `AuthProvider`, `SecretsProvider`) |
| Composition root | `platform/container.ts` |

Deliberate simplifications, not violations:

- **No per-entity repository interfaces.** Canonical Onion often puts an
  `IReviewRepository` interface behind each repository so the *persistence
  layer itself* is swappable. Here, `ReviewRepository` etc. are concrete
  classes — the layering boundary that matters for this project (swappable
  *external services*: LLMs, GitHub, git, embeddings) is enforced via ports;
  the *database* is a fixed choice (Postgres/Drizzle) for the whole app, so
  an extra interface layer over it wouldn't pay for itself at this scope.
  Tests still get isolation because `db` itself is swappable
  (testcontainers vs. mocked repos via `ContainerOverrides`).
- **One `Container` class, not a DI framework.** InversifyJS-style examples
  use decorators and a container library; this repo hand-rolls the same
  effect with a plain class and lazy getters. Same dependency-inversion
  guarantee, less machinery for a course-scope codebase.
- **`reviewer-core` is the strictest ring, not every module.** Only the
  genuinely pure business logic (prompt assembly, grounding, scoring) lives
  fully I/O-free; `service.ts` files are the application ring and are
  expected to call ports — they're not held to `reviewer-core`'s zero-I/O
  bar, only to the "ports, not concrete adapters" bar.

If a future lesson needs the stricter per-repository-interface version (e.g.
to swap Postgres for something else at the persistence layer, not just swap
external services), reach for the canonical pattern in the Stemmler /
InversifyJS references above rather than retrofitting it speculatively now.
