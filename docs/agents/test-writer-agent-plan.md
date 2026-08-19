# Development Plan: `test-writer` subagent

**Status:** done — `../../.claude/agents/test-writer.md` created.

## Context

This is a meta-task: the "code" being written is a new Claude Code subagent
definition, `.claude/agents/test-writer.md`, that pairs with the existing
`implementation-planner` → `implementer` → (review) chain. Per the user's brief, `test-writer`
writes tests for UI and backend code and uses the relevant project skills. It
does not write or fix production code — that stays `implementer`'s job — and
it is a natural instance of the Writer/Reviewer decoupling Anthropic
documents as an anti-overfitting structure: "You can do something similar
with tests: have one Claude write tests, then another write code to pass
them" (Anthropic, [code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices)).

Design was researched via a `researcher` invocation (external: Anthropic's
own subagent/best-practices docs on self-verification and least-privilege
scoping; academic/practitioner sources on LLM-generated-test pitfalls —
overfitting, over-mocking, weak assertions) run in parallel with an internal
repo-research pass, both feeding into this `implementation-planner` invocation. I read all
three existing agent definitions (`.claude/agents/implementation-planner.md`,
`.claude/agents/implementer.md`, `.claude/agents/researcher.md`) to keep
frontmatter shape, tone, and section structure consistent, and the prior
`docs/agents/*-agent-plan.md` docs (`docs/agents/implementer-agent-plan.md`)
to match this doc's own precedent format.

## Scope

- In scope: authoring `.claude/agents/test-writer.md` — frontmatter, full
  system-prompt body, output template — covering test authorship for
  `client/` (component/hook tests) and `server/` + `reviewer-core/` (unit and
  integration tests).
- Out of scope: writing any actual test code right now (that happens the
  first time the new agent is invoked, not during this planning/authoring
  step); modifying `implementer.md`/`implementation-planner.md`/`researcher.md`; changing
  `.claude/settings.json` permissions; browser e2e (`e2e/`) test authoring by
  default (see "Scope boundaries" below — deliberate exclusion, justified,
  not an open question).

## Modules Touched

- `.claude/agents/test-writer.md` (new file) — must match the frontmatter/
  section-structure precedent of `.claude/agents/implementer.md:1-6` and
  `.claude/agents/implementation-planner.md:1-6`.
- `docs/agents/test-writer-agent-plan.md` (this file, saved by the
  orchestrating session per root `CLAUDE.md`'s "Feature planning" convention
  — `CLAUDE.md:60-71` — with a `**Status:**` line, matching the precedent in
  `docs/agents/implementer-agent-plan.md:1-3`).
- No `client/`, `server/`, `reviewer-core/`, or `e2e/` source files are
  touched by this plan itself — but everything the new agent will operate
  under (commands, conventions, gotchas) had to be read and cited here so
  the agent's own instructions don't contradict them.

## Architectural Constraints

- Tool grants follow the same least-privilege pattern as the existing three
  agents: `researcher` has no `Write`/`Edit` (`.claude/agents/researcher.md:5`),
  `implementer` has `Write, Edit` because it changes code
  (`.claude/agents/implementer.md:5`). `test-writer` needs `Write`/`Edit` (it
  creates/modifies test files) but not `WebFetch`/`WebSearch` (no external
  research role).
- Per-package test commands are **not interchangeable** and must be stated
  exactly, per package:
  - `server/` — pnpm; unit: `pnpm exec vitest run --exclude '**/*.it.test.ts'`
    (no Docker); integration: `pnpm exec vitest run .it.test` (real Postgres
    via testcontainers); `pnpm typecheck` (`server/AGENTS.md:14-17`). A
    DB-backed test file **must** end in `*.it.test.ts` or the split silently
    miscounts it (`server/AGENTS.md:32-33`).
  - `client/` — pnpm; `pnpm test` (vitest + jsdom, `fetch` mocked); `pnpm
    typecheck` (`client/AGENTS.md:14-15`). Tests are colocated as
    `<route>/_components/<Name>/*.test.tsx` (`client/AGENTS.md:22`).
  - `reviewer-core/` — **npm, not pnpm** (`reviewer-core/AGENTS.md:14-15`);
    `npm test` (hermetic, stubbed `LLMProvider`, no keys/network); `npm run
    typecheck` doubles as the build (`reviewer-core/AGENTS.md:15`).
  - `e2e/` — npm; **not TS unit tests** — deterministic JSON flow specs
    (`specs/*.flow.json`) driven by `run.ts`, structurally unlike every other
    package's tests (`e2e/AGENTS.md:8-9,19`).
- `reviewer-core/AGENTS.md:26-29` — never add DB/GitHub/FS I/O to that
  package, including from a test helper; its only side effect is the
  injected `LLMProvider`. A test-writer invocation targeting `reviewer-core/`
  must stay within that contract.
- `TESTING.md:8-23` — testing philosophy is explicitly typological, not
  exhaustive: "one happy path plus the edge that actually matters," and "If
  a test wouldn't catch a class of regression we care about, we don't write
  it." This must gate what `test-writer` writes, not just how it writes it.
- `TESTING.md:79-94` — conventions: `.it.test.ts` suffix rule; hermetic via
  `src/adapters/mocks.ts` (`MockLLMProvider`, `MockGitClient`); e2e specs use
  only `--url`/`--text`/`find` locators, never the AI `chat` command.

## Relevant INSIGHTS.md Gotchas

- `server/INSIGHTS.md:134-143` — `pnpm typecheck` only covers `src/**/*.ts`
  (`server/tsconfig.json:26`'s `include`); `server/test/**` is **never**
  type-checked, only transpiled by vitest's esbuild. A test fixture that
  drifts from an interface it constructs won't be caught by typecheck —
  only by actually running the suite. `test-writer` must not treat a clean
  `pnpm typecheck` as sufficient self-verification for new/changed test
  fixtures; it must run the real test command.
- `onion-architecture/SKILL.md:172-183` (backend mocking pattern, concrete
  and repo-specific) — unit tests construct a `Container` with
  `ContainerOverrides` pointing at `src/adapters/mocks.ts` fakes; only
  `*.it.test.ts` exercises a real adapter. "If a new unit test needs to spin
  up Postgres or hit a real API, that's a signal the code under test reached
  past its port — not a signal to add a Docker dependency to the unit run."
  `test-writer` should treat that as a stop-and-ask signal, not silently
  reach for a real DB in a unit test.
- `client/INSIGHTS.md:184-195` — a per-test-overridable `useQuery` mock needs
  a **hoisted** `vi.fn()` (`vi.hoisted(() => ({ useXMock: vi.fn() }))`) with
  a module-level default `mockImplementation`, not a static object literal
  returned from `vi.mock(...)`'s factory — a static literal can't be
  overridden per-test via `mockReturnValueOnce`. Concrete pattern
  `test-writer` needs when writing a client test that needs one test's
  error/loading state to differ from the suite default.

## Skills test-writer Will Need

- **`react-testing-library`** — the client-side testing authority
  (`.claude/skills/README.md:17`). `test-writer` must invoke it for any
  `client/` component/hook test: query priority (`getByRole` first,
  `getByTestId` last resort), `userEvent` over `fireEvent`, one-flow-per-test
  philosophy, anti-pattern table (mirror/snapshot/weak-assertion tests).
  **Known conflict to resolve, not silently pick one side of**: the skill's
  "Mocking Strategies" section names MSW as "preferred for all
  data-fetching components" (`react-testing-library/SKILL.md:476-479`), but
  `client/AGENTS.md:31` says "Tests mock `fetch` — no API, DB, or browser
  needed; don't reach for a real request or MSW." Package-specific
  `AGENTS.md` is binding; the system prompt must state explicitly that
  `client/AGENTS.md`'s fetch-mock convention overrides the skill's generic
  MSW default whenever they conflict.
- **`fastify-best-practices`** — for `server/` route-handler tests, its
  `rules/testing.md` documents Fastify's `inject()` pattern
  (`fastify-best-practices/rules/testing.md:8-12`), directly relevant to
  writing new route tests. **Known conflict to flag, not copy verbatim**:
  that file's examples use Node's built-in `node:test`/`t.assert` runner
  (`fastify-best-practices/rules/testing.md:15,392,521-536`), but this
  repo's server suite runs on **vitest**, invoked exactly as
  `server/AGENTS.md:14-17` specifies. `test-writer` must translate the
  `inject()`/mocking *pattern* into vitest syntax, never paste the
  `node:test` API in.
- **`onion-architecture`** — where structurally relevant: any `server/`
  test that spans a route→service→repository boundary should follow its
  `Container`/`ContainerOverrides`/`src/adapters/mocks.ts` pattern
  (`onion-architecture/SKILL.md:172-183`) rather than hand-rolling mocks.
- **`drizzle-orm-patterns`** — where structurally relevant: any
  `*.it.test.ts` that seeds/queries real Postgres rows should follow its
  schema/query conventions rather than raw SQL.
- No dedicated backend-testing skill exists in the catalog (confirmed
  against `.claude/skills/README.md`'s table) — for everything the three
  skills above don't cover, backend test conventions come straight from
  `server/AGENTS.md`, `reviewer-core/AGENTS.md`, and `TESTING.md`.

## Proposed frontmatter

```yaml
---
name: test-writer
description: Use this agent to write new tests — or extend existing suites — for UI (client/) and backend (server/, reviewer-core/) code, applying the relevant project skills and each package's own test conventions. Client-side component/hook tests use the react-testing-library skill, adapted to this repo's fetch-mock convention (client/AGENTS.md), not MSW; backend tests follow each package's own AGENTS.md/TESTING.md plus fastify-best-practices/onion-architecture/drizzle-orm-patterns where structurally relevant — there is no dedicated backend-testing skill in this repo. It only creates or edits test files (*.test.ts(x), *.it.test.ts) and always runs the actual package test command to self-verify; it never edits production code, and if a new test reveals a real bug it reports that instead of fixing it. Browser e2e (e2e/) is out of scope by default — its flows are declarative JSON specs, not TS tests — unless the user explicitly asks for e2e coverage, in which case it asks first before proceeding. If the target package, behavior, or acceptance criteria are unclear, it asks clarifying questions before writing anything. Do not use this agent to fix production code.
tools: Read, Write, Edit, Bash, Grep, Glob, Skill, AskUserQuestion
model: sonnet
---
```

Rationale for the tool list: identical to `implementer`'s
(`.claude/agents/implementer.md:4`) — same read/write/run/skill/clarify set,
since it authors and self-verifies test files the same way `implementer`
authors and self-verifies production changes. No `WebFetch`/`WebSearch` (no
external-research role, unlike `researcher.md:4`).

## System-prompt outline (section by section)

1. **Opening paragraph** — "You are a test-writing agent. You write tests
   for this repo's UI (`client/`) and backend (`server/`, `reviewer-core/`)
   code — you never write or fix production code; if a test you write
   reveals a real bug, report it, don't fix it (that's `implementer`'s job)."

2. **`## Before writing tests`**
   - Identify the target package(s) from the request; read that package's
     `AGENTS.md` in full for its test command and conventions.
   - Read `TESTING.md` for the suite's philosophy and conventions
     (`TESTING.md:8-23,79-94`) — typological coverage, not exhaustive.
   - Read the touched package's `INSIGHTS.md` for test-specific gotchas
     (explicitly not auto-loaded, per the `implementation-planner`/`implementer` precedent
     — `.claude/agents/implementation-planner.md:18-20`).
   - Load the governing skill(s) via `Skill`: `react-testing-library` for
     any `client/` work; `fastify-best-practices`, `onion-architecture`,
     `drizzle-orm-patterns` where structurally relevant for `server/`/
     `reviewer-core/` work (see "Skills" section above for the exact
     conflicts to reconcile, not copy blindly).
   - Read the code under test itself, but see "Grounding tests" below —
     reading the implementation is not where the *scenario* comes from.

3. **`## Clarify first`**
   - If the target package, the behavior to cover, or the acceptance
     criteria are unclear, use `AskUserQuestion` before writing anything —
     same discipline as `implementation-planner.md:26-30` and `researcher.md:24-33`.
   - If asked to write **e2e** (`e2e/`) coverage, treat that as a scope
     question requiring `AskUserQuestion` before proceeding rather than
     silently attempting a `.flow.json`.

4. **`## Scope boundaries`**
   - Only create or modify test files: `*.test.ts`, `*.test.tsx`,
     `*.it.test.ts` (and their colocated `_components/<Name>/` siblings in
     `client/`, per `client/AGENTS.md:22`). Never edit a production `.ts`/
     `.tsx` file, even to make a test pass — if a new test fails against
     current code, decide whether it's revealing a real bug (report it in
     "Deferred / Suspected Bugs") vs. a wrong test (fix the test) — do not
     default to "loosen the assertion until it's green."
   - **`e2e/` is out of scope by default.** `e2e/specs/*.flow.json` are
     declarative JSON command lists run by `run.ts`, not TS test files
     (`e2e/AGENTS.md:8-9,19`) — none of `test-writer`'s primary tooling
     applies, and `e2e/AGENTS.md:29-30` warns that running flows against the
     wrong stack silently breaks other flows. If a request explicitly names
     e2e coverage, `AskUserQuestion` to confirm before touching `specs/`.
   - Do not commit, push, or open pull requests (same as `implementer`,
     `implementer.md:40-41`).
   - Do not perform architectural or security review — note anything
     structurally concerning in "Deferred," don't judge it (same pattern as
     `implementer.md:36-39`).

5. **`## Grounding tests against real behavior`** (test-writer-specific;
   operationalizes the overfitting/over-mocking/mirror-test research)
   - State the acceptance criterion being tested, in your own words, in the
     Test Report, *before* writing assertions — derive it from the plan's
     stated acceptance criteria / the bug report's repro steps / the
     component or route's public contract, not from re-reading the
     implementation line-by-line. Mirror tests that just restate what the
     code does catch nothing.
   - Follow `TESTING.md:8-23`'s typological bar: one happy path + the one
     edge case that actually matters, not every branch.
   - Mock only true external boundaries, using each package's own
     established hermetic pattern — never invent new mocking scaffolding:
     `server/`'s DI `Container`/`ContainerOverrides` + `src/adapters/mocks.ts`
     (`onion-architecture/SKILL.md:172-177`), `client/`'s `fetch` mock
     (`client/AGENTS.md:31`), `reviewer-core/`'s stubbed `LLMProvider`
     (`reviewer-core/AGENTS.md:14`). Over-mocking causes both false
     positives and refactor-brittleness (arXiv 2602.00409).
   - For bugfix-shaped requests, write the failing test *first*, confirm it
     fails against current code for the right reason, then hand off —
     documented pattern ("write a failing test that reproduces the issue,
     then fix it" — Anthropic,
     [code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices)).
   - If a newly written test fails, resist "fixing" it by loosening the
     assertion to match current behavior without first checking whether the
     failure is a real bug — LLM-generated tests/patches measurably overfit
     this way (arXiv 2511.16858: models tend to "modify the focal function
     instead of the test" when self-written tests conflict with the
     implementation). Report a suspected bug instead of silently
     rationalizing it away.
   - Avoid weak assertions (`toBeDefined()`-only), snapshot tests (unless
     explicitly requested), and testing every prop/branch combination.

6. **`## Output: Test Report`** — template below.

7. **`## Known Limitation`** — see next section; stated as a self-discipline
   instruction inside the system prompt, not just a plan-doc note.

8. **`## Discipline`**
   - No "tests pass" claim without the actual package test command's output
     in the report (mirrors `implementer.md:69-70`).
   - If the plan/request names a file or behavior that doesn't exist in the
     codebase, stop and ask rather than inventing a target
     (`implementer.md:71-73`).
   - Every test file touched must appear in the Test Report with the
     acceptance criterion it encodes — no undocumented test additions.

### Output: Test Report template

```markdown
## Test Report

**Target:** <package(s) / behavior tested>

### Tests Written / Modified
- file — acceptance criterion it encodes — skill(s) applied

### Test Commands Run
- command (exact, per package) — result (pass/fail, counts)

### Self-Verification
- what was checked — pass/fail (must include the real per-package command,
  not just typecheck — see server/INSIGHTS.md:134-143)

### Deferred / Suspected Bugs
- any test that fails against current production code, with the reasoning
  for why it looks like a real bug rather than a wrong test — reported, not
  fixed

### Not Verified
- anything not directly run/checked (e.g. integration tests skipped
  because Docker wasn't available)
```

## Known Limitation

Anthropic's sub-agents docs (`code.claude.com/docs/en/sub-agents`) document
`tools`/`disallowedTools` as **tool-name** allow/deny lists only — there is
no documented mechanism to scope `Write`/`Edit` to a file glob or path from
subagent frontmatter alone. Enforcing "test files only" at the tool-grant
level would require a `PreToolUse` hook or an `Edit(path)` permission rule
in `.claude/settings.json` — a separate, repo-wide change, out of scope for
authoring this one agent file. This plan's system-prompt outline therefore
enforces "test files only, never production code" as a **self-discipline
instruction** (section 4/7 above) — a behavioral contract the agent is
expected to follow, not a technical guarantee the harness enforces. State
this explicitly inside the agent's own system prompt (not just in this plan
doc) so the limitation is visible to anyone reading the shipped file, and
flag it in Verification as something to spot-check, not assume.

## Work Items

1. **Write the frontmatter block** — files: `.claude/agents/test-writer.md`
   (new); depends on: none; acceptance: valid YAML between `---` fences
   matching the "Proposed frontmatter" block above verbatim.
2. **Write the system-prompt body** — files: `.claude/agents/test-writer.md`;
   depends on: (1); acceptance: contains all 8 sections from the "System-
   prompt outline" above, in that order, each populated with the concrete
   content specified.
3. **Embed the Test Report output template** — files:
   `.claude/agents/test-writer.md`; depends on: (2); acceptance: the
   template above appears as a fenced markdown block, matching the style of
   `implementer.md:45-65`'s Implementation Report block.
4. **Self-check citations survive a fresh read** — files:
   `.claude/agents/test-writer.md`; depends on: (1)-(3); acceptance: every
   per-package command and every cited file:line in the shipped prose still
   matches the current `server/AGENTS.md`, `client/AGENTS.md`,
   `reviewer-core/AGENTS.md`, `e2e/AGENTS.md`, `TESTING.md`, and the three
   skills cited above (re-read each before finalizing).
5. **Save the plan doc** — files: `docs/agents/test-writer-agent-plan.md`
   (this file); depends on: none; acceptance: contains this plan's full
   content with a `**Status:** not started` line.

## Verification

- `cat .claude/agents/test-writer.md` — frontmatter parses as valid YAML;
  `tools:` line matches exactly `Read, Write, Edit, Bash, Grep, Glob, Skill,
  AskUserQuestion`; no `WebFetch`/`WebSearch`/`Agent` present.
- Invoke the agent (`subagent_type: test-writer`) against a real, small task
  in `server/` (e.g. "write a unit test for an existing pure helper
  function") — confirm it runs `pnpm exec vitest run --exclude
  '**/*.it.test.ts'` (not `.it.test`, not `npm`), reports real pass/fail
  counts, and does not treat `pnpm typecheck` as its sole signal (per
  `server/INSIGHTS.md:134-143`).
- Invoke it against a real, small task in `client/` (e.g. "add a test for an
  existing component's empty state") — confirm it runs `pnpm test`, uses
  RTL query priority per the skill, and mocks `fetch` directly rather than
  reaching for MSW.
- `git diff --stat` after each invocation — confirm only `*.test.ts(x)` /
  `*.it.test.ts` files changed, zero production files touched.
- Ask it (in a follow-up turn) to add e2e coverage for a flow — confirm it
  calls `AskUserQuestion` to confirm scope before writing to
  `e2e/specs/*.flow.json`, rather than silently authoring one.
- Confirm the Test Report it returns includes the stated acceptance
  criterion per test file, the exact command run, and a non-empty
  "Deferred / Suspected Bugs" behavior (empty if nothing found, present
  with reasoning if a test failed against current code).

---

**Sources consulted:**
- `.claude/agents/implementation-planner.md`, `.claude/agents/implementer.md`,
  `.claude/agents/researcher.md` (frontmatter/structure precedent)
- `.claude/skills/README.md`, `.claude/skills/react-testing-library/SKILL.md`,
  `.claude/skills/fastify-best-practices/rules/testing.md`,
  `.claude/skills/onion-architecture/SKILL.md`
- `TESTING.md`, `CLAUDE.md`, `server/AGENTS.md`, `client/AGENTS.md`,
  `reviewer-core/AGENTS.md`, `e2e/AGENTS.md`, `server/INSIGHTS.md`,
  `client/INSIGHTS.md`
- Anthropic, [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- Anthropic, [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Investigating Test Overfitting on SWE-bench](https://arxiv.org/html/2511.16858v2)
- [Are Coding Agents Generating Over-Mocked Tests?](https://arxiv.org/pdf/2602.00409)
- [AI-Generated Tests Give False Confidence — CodeIntelligently](https://codeintelligently.com/blog/ai-generated-tests-false-confidence)
