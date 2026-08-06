# Frontend UI Architecture — Sources

Sources and rationale behind [`SKILL.md`](SKILL.md), following the repo's
[skill convention](../README.md#creating-new-skills) and the precedent set
by [react-testing-library/README.md](../react-testing-library/README.md).
For the distilled rules see `SKILL.md`; for code see
[examples.md](examples.md).

**Version:** see [Version History](#version-history) at the bottom.

## Motivation

`react-best-practices/SKILL.md` has a single thin "Code Organization"
section (2 bullets). It answers *how a component should behave* (purity,
hooks, memoization) but not *where things live*. This skill is meant to
answer the structural questions that come up every time a new
feature/module is scaffolded:

- Where do components live, and how are they split into files/folders?
- Where do constants live?
- What goes into `utils/` vs `helpers/` vs `services/`?
- Where does business logic live (hooks? services? a domain layer?)?
- Where do types live?
- Barrel files (`index.ts`) — use them or not?
- For Next.js App Router specifically (`client/` in this repo is Next.js
  15): where do feature modules live relative to `app/`? Where does the
  data-access layer live, and what's its contract with Server
  Components/Actions/Route Handlers? Where do business rules live —
  in the Server Action itself, or a separate service/repository layer?
  (Architecture only — performance/caching stays in `next-best-practices`.)

Scope split from neighboring skills: `react-best-practices` stays
behavior/anti-patterns, `next-best-practices` stays App Router
*mechanics* (which file convention, which data-fetching primitive to
call, RSC boundary rules) — it never says where a `features/` folder
should live or where business logic sits above the mechanics. This
skill owns *file/folder organization and layering* for both plain
React and Next.js App Router, explicitly excluding performance (that's
already covered — bundling, image/font optimization, caching — in
`next-best-practices`).

## Sources

### Official / foundational

- [Thinking in React — react.dev](https://react.dev/learn/thinking-in-react) — official guidance on decomposing a UI into components; "a component should ideally only do one thing."
- [Reusing Logic with Custom Hooks — react.dev](https://react.dev/learn/reusing-logic-with-custom-hooks) — when extracting a hook is a clean abstraction vs. premature.
- [Airbnb React/JSX Style Guide](https://github.com/airbnb/javascript/tree/master/react) — one component per file, naming (PascalCase components, camelCase instances), prop conventions.
- [Patterns.dev](https://www.patterns.dev/) — Addy Osmani/Lydia Hallie's reference for design & rendering patterns (HOC, render props, provider, compound components, container/presentational).

### Project structure & architecture methodologies

- [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — feature-folder architecture, unidirectional code flow (`shared → features → app`), most-cited opinionated React structure guide on GitHub.
- [Feature-Sliced Design — official docs](https://feature-sliced.github.io/documentation/) — formal methodology: layers (app/pages/widgets/features/entities/shared) with a strict dependency rule, slices, segments; has a linter + CLI.
- [React Folder Structure Best Practices [2026] — Robin Wieruch](https://www.robinwieruch.de/react-folder-structure/) — pragmatic progression from flat to feature-based structure as an app grows.
- [Delightful React File/Directory Structure — Josh W. Comeau](https://www.joshwcomeau.com/react/file-structure/) — colocation-first approach, one folder per component with tests/styles/hooks alongside.
- [How to Structure and Organize a React Application — Tania Rascia](https://www.taniarascia.com/react-architecture-directory-structure/) — widely-referenced walkthrough of `components/`, `hooks/`, `services/`, `utils/` split and when each is warranted.
- [How to structure a React app in 2026 — dangz.dev](https://dangz.dev/blog/how-to-structure-a-react-app-in-2026) — current (2026) take on feature-based vs. type-based, with a "components/ folder is only for truly reusable UI" rule.

### Component splitting & composition

- [The Container & Presentational Pattern — DEV Community](https://dev.to/masudursourav/the-container-presentational-pattern-separation-of-concerns-in-react-38mc) — classic split; notes the "container" is now usually a hook, not a wrapper component.
- [Rethinking Atomic Design in React Projects — Cheesecake Labs](https://cheesecakelabs.com/blog/rethinking-atomic-design-react-projects/) — where atomic design (atoms/molecules/organisms) helps (design systems) vs. hurts (loses domain context).
- [Atomic Design in React: A first year retrospective — Ironeko](https://ironeko.com/posts/react-atomic-design-a-first-year-retrospective) — real-world post-mortem of adopting atomic design, concrete pain points.

### State & business-logic placement

- [State Colocation will make your React app faster — Kent C. Dodds](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster) — put state as close as possible to where it's used; global state is a leading cause of slow apps.
- [Application State Management with React — Kent C. Dodds](https://kentcdodds.com/blog/application-state-management-with-react) — server-cache state vs. UI state are different problems, shouldn't be managed the same way.
- [Separation of concerns with React hooks — Felix Gerschau](https://felixgerschau.com/react-hooks-separation-of-concerns/) — using custom hooks specifically to pull business/service logic out of components.
- [Clean Architecture on Frontend — Alex Bespoyasov](https://bespoyasov.me/blog/clean-architecture-on-frontend/) — UI / Domain / Infrastructure layering, dependency rule (outer depends on inner, never reverse), domain layer as framework-independent core.
- [CLEAN architecture for React apps — DEV Community](https://dev.to/daslaf/clean-architecture-for-react-apps-3g3m) — applied walkthrough of the same layering inside a real React app.

### Constants

- [How To Organize Constants in a Dedicated Layer in JavaScript — Semaphore](https://semaphore.io/blog/constants-layer-javascript) — dedicated `constants/` layer, one file per logical category (api, routes, config), criteria for when a value earns extraction.
- [How to Add a Constants File to Your React Project — Medium](https://medium.com/@austinpaley32/how-to-add-a-constants-file-to-your-react-project-6ce31c015774) — practical starter pattern, incl. i18n content files as a constants variant.

### Types (TypeScript)

- [How to Organize Types in a React Project — Wisp CMS](https://www.wisp.blog/blog/how-to-organize-types-in-a-react-project) — start with colocation, promote to a shared `types/` folder only once reused across features.
- [React-Ts-Best-Practices — seanpmaxwell (GitHub)](https://github.com/seanpmaxwell/React-Ts-Best-Practices) — community-maintained checklist for typing components/props/state.

### Barrel files (`index.ts`)

- [Please Stop Using Barrel Files — TkDodo](https://tkdodo.eu/blog/please-stop-using-barrel-files) — highest-signal source on this; measured build/bundle cost (extra modules, ~14% bundle bloat, worse with wildcard exports), circular-dependency hotspots. TkDodo maintains TanStack Query — credible on build tooling. Verdict: fine at a published package's public edge, avoid inside the app.

### Next.js App Router — file conventions (relevant since `client/` is Next.js 15)

- [Getting Started: Project Structure — nextjs.org](https://nextjs.org/docs/app/getting-started/project-structure) — official file-conventions and top-level folder guidance.
- [Project Organization and File Colocation — nextjs.org](https://nextjs.org/docs/14/app/building-your-application/routing/colocation) — official rules for route groups (`(folder)`) and private folders (`_folder`) as colocation tools that don't affect the URL.

### Next.js App Router — architecture at scale (not performance)

The user asked specifically for Next.js *architecture* guidance (where
features/business logic/data access live above the routing layer),
distinct from the mechanics `next-best-practices` already covers and
from performance tuning.

- [Guides: Data Security — nextjs.org (official)](https://nextjs.org/docs/app/guides/data-security) — the canonical Data Access Layer (DAL) pattern: centralize all data reads behind server-only functions, do authorization *inside* the DAL (not in middleware), return plain DTOs — never raw ORM/DB models — to components. This is the single highest-authority source for "where does data access live" in App Router.
- [Usage with Next.js — Feature-Sliced Design (official)](https://feature-sliced.design/docs/guides/tech/with-nextjs) — official FSD guidance for App Router: `app/` stays routing-only (`page.tsx` imports Widgets/Features, no business logic inline); layer-name collision with Next's own `app`/`pages` folders is resolved with prefixed FSD layer names (`_app`, `_pages`).
- [The Ultimate Next.js App Router Architecture — Feature-Sliced Design blog](https://feature-sliced.design/blog/nextjs-app-router-guide) — deeper walkthrough of the same, combining FSD's layer/slice rules with App Router's server-first, streaming model; explicit caveat that FSD is worth the boilerplate only past ~20 features.
- [Structuring Your Data Access Layer in Next.js — Patterns That Actually Scale — Medium](https://medium.com/@samrose.mohammed/structuring-your-data-access-layer-in-next-js-patterns-that-actually-scale-2e4c07491866) — practical elaboration of the DAL pattern: no raw Prisma/ORM calls outside `lib/dal/`, Server Components/Actions/Route Handlers all call into the DAL rather than the database directly.
- [Managing complexity: Shared business logic in Next.js (Part 1: Server-Side Architecture) — Alvis Ng / Yopeso](https://medium.com/yopeso/managing-complexity-shared-business-logic-in-next-js-part-1-server-side-architecture-13ebdce38377) — layered architecture for Next.js specifically: presentation → actions (coordinate, don't contain business rules) → services/repositories; "Manager" layer for logic narrower than a service (calculators, formatters).
- [Building Production-Grade Next.js: Part 1, Architecture & Structure — Medium](https://medium.com/@kaveeshbc/building-production-grade-next-js-part-1-architecture-structure-c3b0e448d8f0) — production-oriented folder layout: `app/` for routing only, `features/` grouped by domain (components, hooks, services, api, store, types per feature), `shared/` for cross-feature reuse, `core/` for app-level concerns; explicit dependency rule `components → hooks → services → api`.
- [Comprehensive Next.js Full Stack App Architecture Guide — Arno](https://arno.surfacew.com/posts/nextjs-architecture) — end-to-end architecture guide (not a perf piece) covering how rendering-strategy choice (SSG/ISR/RSC) feeds back into where data-fetching and business-logic code should live.

Recurring theme across all of the above, carried into `SKILL.md`: `app/`
(or `pages/`) is routing only — no business logic, no direct DB/ORM calls.
Everything else (`features/`, `lib/dal/` or similar) lives outside it and
flows one direction: components → hooks → services/actions →
data-access layer.

## Validated Against This Repo

Before writing `SKILL.md`, `client/src/` was inspected directly (rather
than importing generic advice wholesale) — this is what settled the open
questions from the first research pass:

- **Feature-based or type-based?** Neither, cleanly — it's
  **route-colocation**: `<route>/_components/<Name>/`, nested again for
  large components (`RunTraceDrawer/_components/PromptBlock/`). No
  top-level `features/` directory exists or is needed at this size. This
  matches Josh Comeau's colocation-first approach and Next.js's own
  private-folder (`_folder`) convention more than it matches
  Feature-Sliced Design or bulletproof-react's `features/` split.
- **Component folder anatomy** is already consistent across 40+ folders:
  `Name.tsx` + `Name.test.tsx` + `index.ts` (single re-export) +
  optional `constants.ts` / `helpers.ts` / `styles.ts` / `hooks/`. Encoded
  verbatim in `SKILL.md`'s "Component Folder Anatomy" section.
- **Constants**: colocated per component (`AgentCard/constants.ts`,
  `FindingCard/constants.ts`, 13+ instances), never a global
  `constants/` folder — confirms the "colocate first, promote once
  reused" reading over the "dedicated constants layer" reading from the
  Semaphore/Medium sources below.
- **Utils vs helpers vs services**: no `services/` folder exists. The
  boundary is `lib/api.ts` (documented in `client/AGENTS.md` as "the only
  place that knows `NEXT_PUBLIC_API_BASE`") plus one `lib/hooks/<domain>.ts`
  per API domain (`agents.ts`, `reviews.ts`, `repo-intel.ts`, `trace.ts`,
  `core.ts`). Component-local logic uses colocated `helpers.ts`; there is
  no generic `utils.ts`.
- **DAL pattern**: doesn't apply verbatim, because `client/` never touches
  Postgres directly — it always calls `server/`'s REST API. `lib/api.ts`
  is this repo's equivalent enforcement point. `SKILL.md` notes the real
  `server-only`/DTO pattern as the fallback *if* a future lesson adds
  direct DB access from a Server Component.
- **Types**: no per-component `types.ts` observed; component-specific
  types stay inline, cross-cutting ones centralize in `lib/types.ts` /
  `lib/feature-models.ts`.
- **Barrel files**: this repo uses `index.ts` *extensively* — but only
  ever as a single-export re-export per component (40+ instances), which
  is the "safe at the public edge" case TkDodo's article describes, not
  the wildcard-export case it warns against. There is exactly **one**
  `export *` wildcard barrel (`lib/hooks/index.ts`), and it's documented
  inline with why. `SKILL.md` distinguishes the two explicitly instead of
  giving a blanket "avoid barrels" rule that would have contradicted an
  established, working repo convention.

## Version History

- **1.0.0** (2026-08-06) — Initial version. Sources collected from web
  research (see above), rules distilled and cross-checked against
  `client/src/`'s actual structure and `client/AGENTS.md`. Scope
  deliberately excludes performance (owned by `next-best-practices`) and
  component behavior/anti-patterns (owned by `react-best-practices`).
