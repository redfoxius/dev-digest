# Onion Architecture skill — plan

**Status:** done

## Context

`server/` already grew an onion/hexagonal-ish shape organically — one plugin
per domain (`modules/<name>/routes.ts` + `service.ts` + `repository.ts`), a
composition-root DI container (`platform/container.ts`), adapters behind port
interfaces (`adapters/*`, typed via `vendor/shared`), and `reviewer-core` as a
side-effect-free domain core (only side effect: an injected `LLMProvider`).
Nothing named this pattern or enforced it, so new modules could drift — e.g.
a service reaching for `drizzle-orm` directly, or a route doing business
logic inline. This skill makes the existing shape explicit and forces new
backend code to keep the dependency rule: **dependencies point inward only;
the core never imports infrastructure.**

Modeled on `.claude/skills/frontend-ui-architecture/` (same "architecture,
not behavior" scope — cf. `react-best-practices`/`next-best-practices` owning
behavior/mechanics, `frontend-ui-architecture` owning layering).
`onion-architecture` plays the same role for backend: it complements
`fastify-best-practices` (HTTP mechanics) and `drizzle-orm-patterns` (query
mechanics) by owning *where logic and dependencies live*.

## Scope

- Primary target: `server/` — modules, adapters, container, vendor/shared
  contracts.
- `reviewer-core/` is cited throughout as the canonical "pure domain core"
  reference (already enforces the rule via its own `AGENTS.md`: "Never add
  DB/GitHub/FS calls here") — the worked example of the innermost ring done
  right, not additional rules invented for it.

## What shipped

Created `.claude/skills/onion-architecture/`:

1. **`SKILL.md`** — frontmatter, positioning vs. `fastify-best-practices`/
   `drizzle-orm-patterns`, an ASCII ring diagram, Severity Levels
   (CRITICAL/HIGH/MEDIUM), and rule sections: The Dependency Rule, Ports &
   Adapters, Module Anatomy (routes→service→repository), Composition Root,
   Domain Purity (reviewer-core reference), Contracts as the Cross-Ring
   Language, Testability Follows From the Rule, Anti-Patterns/Red Flags.
2. **`examples.md`** — good/bad pairs from real files
   (`modules/reviews/{routes,service,repository}.ts`, the `container.ts`
   GitHub-adapter wiring, `reviewer-core`'s `reviewPullRequest` signature)
   plus a before/after for a hypothetical new `webhooks` module.
3. **`README.md`** — sources (below) plus a table mapping this repo's shape
   onto the canonical Onion/Hexagonal/Clean layer names, and a section on
   deliberate simplifications (no per-entity repository interfaces, no DI
   framework) vs. violations.
4. Added a Backend-scope row to `.claude/skills/README.md`'s catalog,
   cross-referencing `fastify-best-practices`/`drizzle-orm-patterns` the same
   way `frontend-ui-architecture` cross-references its siblings.

## Sources cited in README.md

- [Understanding Onion Architecture: A Clean Approach to Software Design](https://medium.com/lets-code-future/understanding-onion-architecture-a-clean-approach-to-software-design-f41af77b72d8)
- [Mastering Onion Architecture](https://www.numberanalytics.com/blog/mastering-onion-architecture)
- [Onion Architecture in Practice](https://www.numberanalytics.com/blog/onion-architecture-in-practice)
- [Onion Architecture in Software Development](https://codefinity.com/blog/Onion-Architecture-in-Software-Development)
- [Onion Architecture in Node.js with TypeScript](https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391)
- [Implementing SOLID and the Onion Architecture in Node.js with TypeScript and InversifyJS](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad)
- [Clean Node.js Architecture — Khalil Stemmler](https://khalilstemmler.com/articles/enterprise-typescript-nodejs/clean-nodejs-architecture/)
- [Hexagonal Architecture (Ports and Adapters): A Complete Guide with a TypeScript Example](https://generalistprogrammer.com/tutorials/hexagonal-architecture-complete-guide)
- [Clean Architecture: A Complete Guide to Layers, the Dependency Rule, and How It Compares to Onion and Hexagonal](https://generalistprogrammer.com/tutorials/clean-architecture-complete-guide)
- [Ports and Adapters (Hexagonal Architecture) — Software Architecture Wiki](https://synchronium.github.io/software-architecture-wiki/styles/ports-and-adapters.html)

## Verification

- No runtime behavior changes — documentation/skill-authoring only.
- Every concrete file/symbol cited (`container.ts`, `modules/reviews/*`,
  `vendor/shared/adapters.ts` interface names) was read directly from the
  repo before writing the skill, so paths and names are accurate as of
  2026-08-06.
- `.claude/skills/README.md` catalog table still renders as valid Markdown
  (same column count as existing rows).
