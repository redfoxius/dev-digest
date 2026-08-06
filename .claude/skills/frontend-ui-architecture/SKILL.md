---
name: frontend-ui-architecture
description: "Defines where frontend code lives and how it's layered: folder/feature structure, component-folder anatomy, component splitting, constants placement, utils vs helpers vs services, business-logic placement (custom hooks, API/service boundary), types organization, and barrel-file (index.ts) conventions — for plain React and this repo's Next.js App Router client. Use when scaffolding a new feature/component, deciding where a file or piece of logic belongs, or reviewing/refactoring project structure. Architecture and code organization only — NOT component behavior/anti-patterns (see react-best-practices) and NOT Next.js routing mechanics, data-fetching primitives, or performance (see next-best-practices)."
version: "1.0.0"
---

# Frontend UI Architecture

Where frontend code lives and how it's layered. Complements the two
sibling skills instead of overlapping them:

- **`react-best-practices`** owns component *behavior* — purity, hooks
  rules, memoization, anti-patterns.
- **`next-best-practices`** owns App Router *mechanics* — which special
  file, which data-fetching primitive, caching, performance.
- **This skill** owns *where things live and how they're layered* — for
  plain React feature work and for `client/`'s Next.js App Router app.

Grounded in `client/`'s actual structure. `client/AGENTS.md`'s "Where
things live" section is the authoritative map for this repo; this skill
explains *why* it looks that way, gives it more surface area, and tells
you how to extend it consistently for cases AGENTS.md doesn't spell out.
For code examples, see [examples.md](examples.md). For sources and
rationale, see [README.md](README.md).

## Severity Levels

- **CRITICAL** — wrong layer for logic/data-access; will cause coupling,
  untestability, or duplicated business rules
- **HIGH** — structure that causes real scaling pain (merge conflicts,
  unclear ownership, cross-feature coupling)
- **MEDIUM** — organizational polish; wrong today, cheap to fix later

---

## Folder & Feature Structure (HIGH)

- Prefer route-colocation over a separate top-level `features/` directory:
  put a component under the route that owns it, in a private `_components/`
  folder (the underscore prefix excludes it from Next.js routing). Reserve
  top-level `components/` for UI reused across **2+ routes**.
  - This repo: `<route>/_components/<Name>/` for route-local components;
    cross-route pieces (`app-shell`, `diff-viewer`, `page-shell`) live in
    `src/components/`.
- Nest `_components/` again inside a component folder once it grows
  internal subcomponents, instead of flattening everything into one folder
  (e.g. `RunTraceDrawer/_components/PromptBlock/`).
- Don't introduce a parallel `features/` directory outside `app/` unless
  the project is genuinely multi-team or has 20+ features — that's
  Feature-Sliced-Design territory (see README) and adds indirection this
  size of app doesn't pay back yet.
- Unidirectional dependency flow: `components/` / `lib/` (shared) →
  route-local `_components/` → the route itself. A shared component must
  never import from a specific route's `_components/`.
- `vendor/shared` and `vendor/ui` are a special case (hand-copied,
  cross-package contracts — see root `AGENTS.md`) — don't restructure them
  under this skill's rules; they follow their own sync convention.

## Component Folder Anatomy (HIGH)

Established, consistent pattern in this repo (40+ folders follow it) —
default to it for every component beyond trivial size:

```
ComponentName/
  ComponentName.tsx      # the component
  ComponentName.test.tsx
  index.ts                # single re-export — the folder's public API
  constants.ts             # colocated, component-scoped constants (optional)
  helpers.ts               # colocated pure helper functions (optional)
  styles.ts                 # colocated style objects, if not pure Tailwind (optional)
  hooks/                     # colocated hooks — only once there's >1, or one reused within the folder
```

- Skip the folder entirely for a trivial one-off component — a single
  `.tsx` file is fine until it grows a sibling file.
- `index.ts` re-exports exactly one thing
  (`export { X, X as default } from "./X"`) — see **Barrel Files** below
  for why this specific shape is the safe kind.

## Component Splitting & Composition (HIGH)

Sizing/purity rules (max lines, max props, pure render) live in
`react-best-practices` — this skill only adds *where the split lands on
disk*.

- When a component splits into a data-fetching half and a rendering half,
  the data-fetching half is a hook (colocated `hooks/`, or `lib/hooks/`
  for cross-component reuse) — not a wrapper "container" component. The
  presentational half stays the folder's default export.
- Don't over-split: a subcomponent or hook with exactly one caller and no
  independent meaning is easier to read inlined back into its parent.
- Atomic design (atoms/molecules/organisms) is a design-system pattern,
  not a feature-code pattern — skip it for route/`_components/` work. It
  would only make sense if `vendor/ui` grew into a real multi-app design
  system.

## Constants (MEDIUM)

- Colocate: a `constants.ts` inside the component folder that uses it —
  this repo does this consistently (`AgentCard/constants.ts`,
  `FindingCard/constants.ts`, `VerdictBanner/constants.ts`, …). There is
  no global `constants/` directory, and none should be added speculatively.
- Promote a constant to a shared location (`lib/`) only once it's actually
  reused across **2+ unrelated** component folders.
- A one-off value used exactly once (a single magic padding number)
  doesn't earn a constants file — inline it.

## Utils vs Helpers vs Services (MEDIUM)

- `helpers.ts` colocated in a component folder = logic specific to that
  component only (e.g. `AgentCard/helpers.ts` → `modelColor()`). Not
  meant to be imported by anything else.
- Cross-component pure functions (formatting, URL building) go in `lib/`
  as a file named for what it does (`lib/format.ts`, `lib/github-urls.ts`)
  — never a generic `utils.ts` junk drawer that accumulates unrelated
  functions.
- This repo has no `services/` folder. The equivalent boundary is
  `lib/api.ts` — the **only** module allowed to know
  `NEXT_PUBLIC_API_BASE` or call `fetch` against the API — plus
  `lib/hooks/*.ts`, one file per API domain, wrapping it in TanStack Query
  hooks. A new API domain gets a new `lib/hooks/<domain>.ts`, never a
  scattered `fetch()` inside a component.

## Business Logic Placement (CRITICAL)

- All data fetching/mutation logic lives in a `lib/hooks/<domain>.ts`
  TanStack Query hook, never inline in a component body — this is the
  concrete file target for `react-best-practices`' "Data Fetching" rule
  in this repo.
- Component-local business logic (derived values, formatting specific to
  one component) → colocated `helpers.ts`.
- Logic reused by 2+ components but not generic enough for `lib/utils`
  → promote to `lib/`, named by domain (what it's for), not by type
  (what kind of file it is).

## Data Access Boundary — Next.js Specifics (CRITICAL)

- The common industry pattern for App Router is a server-only Data Access
  Layer (`import 'server-only'`, authorization checks inside, DTOs out) —
  for apps where Server Components read a database directly. That doesn't
  apply verbatim here: `client/` never touches Postgres, it always goes
  through `server/`'s REST API.
- The equivalent boundary in this repo is `lib/api.ts`: treat it like a
  DAL. Nothing outside `lib/api.ts` and `lib/hooks/*` should construct a
  request URL or call `fetch` against the API — that's the enforcement
  point, same role a real DAL plays for direct DB access.
- If a future lesson adds a Server Component that reads Postgres directly
  (bypassing `server/`), reach for the real DAL pattern — `server-only`,
  auth-in-layer, DTOs out — see README sources for the canonical
  reference.

## Types (MEDIUM)

- Component-specific types stay inline in the component file — this repo
  never creates a `types.ts` at the single-component scope.
- Cross-cutting types live centrally in `lib/types.ts` /
  `lib/feature-models.ts` — promote a type there only once 2+ components
  need it.
- Contracts shared with `server/` are never redefined here — see root
  `AGENTS.md`'s `vendor/shared` convention (edit both hand-copied sides,
  don't invent a third source of truth).

## Barrel Files — `index.ts` (MEDIUM)

Two different things get called "barrel files" — this repo deliberately
uses one and avoids the other:

- **Safe, and the default here**: a per-component `index.ts` re-exporting
  exactly one component (`export { X, X as default } from "./X"`). 40+ of
  these exist. Keep doing this — it's a stable public-API seam for a
  single module, not a wildcard re-export, so it doesn't carry the
  bundle-bloat / circular-dependency cost that "avoid barrel files"
  advice targets.
- **Use sparingly**: a directory-wide `export *` barrel aggregating many
  modules. `lib/hooks/index.ts` is the one deliberate exception in this
  repo, and it's documented inline with *why* both import paths need to
  resolve. Don't add a second wildcard barrel without the same kind of
  justification — prefer importing a specific `lib/hooks/<domain>` file
  directly.

## Naming (MEDIUM)

- PascalCase for component folders/files; camelCase for everything else
  (hooks, helpers, constants exports) — matches the Airbnb convention and
  this repo's existing files.
- Hook files and functions start with `use`.
