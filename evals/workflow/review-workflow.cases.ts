import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 12 Claude sessions total.
 *   - 6 × trace (routing/dual-read)                        = 6
 *   - 2 × trace (package AGENTS.md discovery)               = 2
 *   - 2 × activation pair (engineering-insights)            = 2
 *   - 2 × activation pair (pr-self-review manual-only)      = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): server API conventions ("Docs map": README.md "API map") + dispatch ----
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    name: "API-route task reads server/README.md AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з конвенціями API цього репо (за AGENTS.md пакета server/, розділ " +
      "Docs map). Потім ОБОВʼЯЗКОВО запусти сабагента architecture-reviewer, щоб він оцінив мій план " +
      "на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/README.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): reviewer-core Docs map -> README.md "Pipeline" section ------------------
  {
    kind: "trace",
    // Tests the AGENTS.md "Docs map" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Earlier phrasing ("розберись, як усе влаштовано") sent the model straight
    // into schema.ts / pipeline.run.ts and it never opened the routed doc. One anchor doc (README.md)
    // keeps this a deterministic routing check — asserting two docs in one session is inherently flaky.
    name: "pipeline task follows reviewer-core/AGENTS.md Docs map to README.md",
    prompt:
      "Я збираюся змінити review pipeline у reviewer-core/. Перш ніж торкатися коду — звірся з " +
      "AGENTS.md цього пакета (розділ Docs map), і прочитай саме той документ, що описує pipeline.",
    expectFilesRead: ["reviewer-core/README.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): reviewer-core Docs map -> INSIGHTS.md (gotchas/dev log) ------------------
  {
    kind: "trace",
    name: "reviewer-core AGENTS.md routes a gotchas lookup to INSIGHTS.md",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо (AGENTS.md пакета reviewer-core/), де це вже могло бути " +
      "задокументовано? Прочитай той файл.",
    expectFilesRead: ["reviewer-core/INSIGHTS.md"],
    maxTurns: 5,
  },

  // --- trace (1 session): root CLAUDE.md Docs map -> TESTING.md ------------------------------------
  {
    kind: "trace",
    name: "cross-package testing question routes to root TESTING.md",
    prompt:
      "Мені треба зрозуміти загальну стратегію тестування across усіх пакетів цього репо, перш ніж " +
      "додавати новий тест. За Docs map кореневого CLAUDE.md — який файл описує саме це? Прочитай його.",
    expectFilesRead: ["TESTING.md"],
    maxTurns: 5,
  },

  // --- trace (1 session): non-default convention -> BOTH vendored copies of @devdigest/shared -----
  {
    kind: "trace",
    // CLAUDE.md: "@devdigest/shared is NOT a package — hand-copied into server/src/vendor/shared AND
    // client/src/vendor/shared. Edit BOTH ... they already drift when you don't." A plan that reads
    // only one copy has missed this non-default convention.
    name: "shared-contract change reads BOTH vendored copies per CLAUDE.md",
    prompt:
      "Хочу додати нове поле до спільного типу PullRequestSummary, яким користуються і server, і " +
      "client. Перш ніж пропонувати зміну — звірся з кореневим CLAUDE.md щодо того, де саме живе цей " +
      "спільний контракт, і прочитай усі релевантні файли.",
    expectFilesRead: ["server/src/vendor/shared", "client/src/vendor/shared"],
    maxTurns: 8,
  },

  // --- trace (1 session): session protocol reads the TOUCHED package's own INSIGHTS.md, not another
  {
    kind: "trace",
    // CLAUDE.md Session protocol: "Before touching a package, skim THAT package's own INSIGHTS.md
    // (not the whole repo's)." The negative half is the real assertion — a model that just greps
    // every INSIGHTS.md it can find would pass a positive-only version of this case.
    name: "server task skims server/INSIGHTS.md per session protocol, not client's",
    prompt:
      "Хочу додати новий Fastify-маршрут у server/src/modules/reviews. Перш ніж писати код, " +
      "дотримайся Session protocol з кореневого CLAUDE.md: прочитай саме той файл, який там вказано " +
      "переглянути перед торканням пакета.",
    expectFilesRead: ["server/INSIGHTS.md"],
    avoidFilesRead: ["client/INSIGHTS.md"],
    maxTurns: 5,
  },

  // --- trace (2 sessions): package AGENTS.md is discovered when work targets that package ---------
  {
    kind: "trace",
    name: "task inside client/ reads client/AGENTS.md before touching code",
    prompt:
      "Хочу додати новий TanStack Query хук у client/src/lib/hooks. Перш ніж писати код — прочитай " +
      "усі релевантні інструкції саме для пакета client/ (його AGENTS.md).",
    expectFilesRead: ["client/AGENTS.md"],
    maxTurns: 6,
  },
  {
    kind: "trace",
    name: "task inside server/ reads server/AGENTS.md before touching code",
    prompt:
      "Хочу додати новий Fastify-модуль у server/src/modules. Перш ніж писати код — прочитай усі " +
      "релевантні інструкції саме для пакета server/ (його AGENTS.md).",
    expectFilesRead: ["server/AGENTS.md"],
    maxTurns: 6,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ---------------------------------
  // `isolate: true` on every case below: a live incident during eval development had this exact
  // pair Write-mutate server/INSIGHTS.md with fabricated content, and the pr-self-review pair below
  // Bash-execute `git add`/`rm`/`git commit` against the REAL repo — none of those tools are in
  // WORKFLOW_ALLOWED_TOOLS, but permissionMode:"bypassPermissions" let them run anyway. Both
  // incidents were reverted by hand; these cases now run against a disposable clone instead (see
  // isolated-repo.ts) so a repeat can't touch the real working tree.
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    // Earlier phrasing ("Хочу це зафіксувати") was ambiguous between "record" and "fix" in Ukrainian
    // and let the model treat this as an active debugging request instead of a wrap-up. Stating the
    // fix is already applied removes that ambiguity. Deliberately does NOT name INSIGHTS.md — that
    // invited the model to inspect/handle the file directly instead of delegating to the skill.
    // maxTurns raised (4 -> 6): a capable model exploring server/ first (AGENTS.md, INSIGHTS.md) to
    // orient before invoking the skill was running out of turns before the Skill call landed.
    prompt:
      "Щойно закінчив налагоджувати баг у server/: pgvector-запит повертав нуль рядків, бо " +
      "розмірність колонки не збіглася після зміни моделі ембедингів. Фікс уже застосований і " +
      "працює. Хочу задокументувати цю знахідку, щоб команда не наступила на ті самі граблі.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 6,
    isolate: true,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
    isolate: true,
  },

  // --- activation pair (2 sessions): pr-self-review is manual-only, never auto-fired ---------------
  {
    kind: "activation",
    // CLAUDE.md: "pr-self-review is manual-only — never invoke it automatically after `gh pr create`
    // or a `git push`." Narrating a just-succeeded gh pr create must NOT trigger the skill.
    name: "pr-self-review must NOT auto-fire after a gh pr create narration",
    prompt: "Я щойно успішно виконав `gh pr create` для цієї гілки, і PR створився без помилок.",
    skill: "pr-self-review",
    shouldActivate: false,
    maxTurns: 4,
    isolate: true,
  },
  {
    kind: "activation",
    // The positive half of the pair — without it, "shouldActivate: false" above would trivially
    // pass if the skill never fires under any prompt at all.
    name: "pr-self-review activates on an explicit pre-merge ask",
    prompt: "Я хочу помержити цей PR. Перед цим прогони /pr-self-review, щоб перевірити критичні знахідки.",
    isolate: true,
    skill: "pr-self-review",
    shouldActivate: true,
    maxTurns: 4,
  },
];
