# Агенти (`.claude/agents/`)

Карта наявних субагентів проєкту. Тут — лише відповідальність, дозволи та
контракт вхід/вихід кожного агента; повні системні промпти дивись у
відповідних `.md`-файлах цієї теки, докладний why-контекст — у
[`docs/agents/`](../../docs/agents/).

## Конвеєр

```
researcher  →  planner  →  implementer  →  test-writer
(read-only)    (read-only,   (пише код,      (пише тести,
                план)         Write/Edit)     Write/Edit)
                                   │
                                   ▼
                    plan-verifier   architecture-reviewer   doc-writer
                    (read-only,     (read-only, знахідки     (пише docs/,
                     MET/NOT MET/    з file:line-доказами)    діаграми)
                     UNVERIFIABLE)
                                   │
                                   ▼
                    (review skills: onion-architecture, security,
                     pr-self-review, ...)
```

`researcher`, `planner`, `plan-verifier` і `architecture-reviewer` не
пишуть код — вони віддають артефакт (звіт, план або знахідки) назад у
сесію, яка їх викликала. `planner` не зберігає план сам — за конвенцією
репозиторію (`CLAUDE.md`) це робить оркеструвальна сесія, у
`docs/<feature-slug>-plan.md`. `implementer` і `test-writer` виконують
готовий план/пишуть тести і теж не комітять/не пушать/не відкривають PR —
це залишається за сесією. `doc-writer` — єдиний агент окрім
`implementer`/`test-writer`, що має `Write`/`Edit`, і то лише для
пост-імплементаційної документації в `docs/`, ніколи для коду.
Архітектурний і секьюриті-огляд лишається розподілений між скілами
(`onion-architecture`, `security`, `pr-self-review`) та новим
`architecture-reviewer` — жоден агент не підміняє цю перевірку загальними
порадами: `plan-verifier` вимагає доказу під кожен вердикт, а
`architecture-reviewer` — file:line-цитати під кожну знахідку.

## Огляд

| Агент | Відповідальність | Дозволи (`tools`) | Модель | Вхід | Вихід |
|---|---|---|---|---|---|
| [`researcher`](researcher.md) | Дослідження без модифікації файлів: пошук у кодовій базі (патерни, історія) і/або зовнішніх джерелах (доки, веб). Уточнює запит через `AskUserQuestion`, якщо в ньому немає конкретного питання. | `Read, Grep, Glob, Bash, WebFetch, WebSearch, AskUserQuestion` — без `Write`/`Edit` | sonnet | Конкретне дослідницьке питання | Repository Research Report і/або External Research Report (Findings → Evidence → References → Could Not Determine, з `file:line`/URL-цитуванням) |
| [`planner`](planner.md) | Перетворює запит на фічу/багфікс на структурований Development Plan до написання будь-якого коду. Читає `AGENTS.md`/`CLAUDE.md` і `INSIGHTS.md` зачеплених модулів та каталог скілів, щоб план не суперечив правилам, якими згодом буде зв'язаний `implementer`. Файлів не пише. | `Read, Grep, Glob, Bash, Skill, AskUserQuestion` — без `Write`/`Edit` | sonnet | Запит на фічу/багфікс (за потреби уточнений через `AskUserQuestion`) | Development Plan (Context → Scope → Modules Touched → Architectural Constraints → INSIGHTS.md Gotchas → Skills Implementer Will Need → Work Items → Verification), з `**Status:**` — призначений для збереження у `docs/<slug>-plan.md` |
| [`implementer`](implementer.md) | Виконує вже готовий Development Plan (від `planner` або з `docs/<slug>-plan.md`) у `client/` і `server/`. Підбирає й застосовує релевантні скіли на файл, вносить зміни, ганяє наявні test/typecheck-команди — і більше нічого. Архітектурний/секьюриті-огляд і git-операції (commit/push/PR) — поза межами. | `Read, Write, Edit, Bash, Grep, Glob, Skill, AskUserQuestion` | sonnet | Development Plan (від `planner` або файл) | Implementation Report (Completed → Tests Run → Self-Verification → Deferred/Out of Scope → Not Verified) |
| [`test-writer`](test-writer.md) | Пише/розширює тести для UI (`client/`) і backend (`server/`, `reviewer-core/`), застосовуючи `react-testing-library` (адаптований під fetch-mock конвенцію репо, не MSW) для фронтенду й `AGENTS.md`/`TESTING.md`-конвенції пакета + `fastify-best-practices`/`onion-architecture`/`drizzle-orm-patterns` для бекенду. Ніколи не редагує production-код — про знайдений баг лише звітує. `e2e/` поза скоупом за замовчуванням (JSON flow-специ, інша технологія). | `Read, Write, Edit, Bash, Grep, Glob, Skill, AskUserQuestion` (обмеження на "лише тестові файли" — дисципліна промпту, не технічний гарант) | sonnet | Запит на тести для конкретного пакета/поведінки | Test Report (Tests Written/Modified → Test Commands Run → Self-Verification → Deferred/Suspected Bugs → Not Verified) |
| [`architecture-reviewer`](architecture-reviewer.md) | Read-only перевірка архітектурних меж diff/PR/branch/directory: роутить файли по шляху на `onion-architecture` (`server/`, `reviewer-core/`), репо-локальний `frontend-ui-architecture` (`client/`) і глобальний `golang-architecture` (`*.go`, якщо доступний). Кожна знахідка — з file:line-цитатою й незалежною оцінкою по осі (layering, dependency direction, composition root); не додає style-preference чи теоретичні зауваження. | `Read, Grep, Glob, Bash, Skill, AskUserQuestion` — без `Write`/`Edit` | sonnet | Ціль огляду (diff, PR, branch або directory) | Findings — JSON-масив (`file`, `line`, `skill`, `severity`, `summary`, `rationale`); порожній масив, якщо нічого не проходить поріг CRITICAL/WARNING/SUGGESTION |
| [`plan-verifier`](plan-verifier.md) | Звіряє готовий код з кожним пунктом Development Plan і Implementation Report — ніколи не підміняє перевірку загальними порадами. Кожен критерій отримує вердикт MET/NOT MET/**UNVERIFIABLE** з доказом (file:line або реально виконана команда); неоднозначний критерій ("чи могли б дві людини не погодитись") — завжди UNVERIFIABLE, ніколи не вгадується. Окремо перевіряє Architectural Constraints — те, що сам `implementer` свідомо не оцінює. | `Read, Grep, Glob, Bash, Skill, AskUserQuestion` — без `Write`/`Edit` | sonnet | Development Plan + Implementation Report (або diff, якщо звіту немає — реконструює сам) | Plan Verification Report — таблиці вердиктів по критеріях/Architectural Constraints/Scope/Skills + Overall Verdict (PASS / PASS WITH GAPS / FAIL) |
| [`doc-writer`](doc-writer.md) | Перетворює вже реалізовану фічу (план, PR, діапазон комітів) на reference/explanation-документацію з діаграмами (за Diátaxis-евристикою) і вирішує, куди в `docs/` вона йде — `docs/<feature-slug>.md` чи `docs/<topic>/README.md`. Ніколи не дублює вміст, який власне вже описаний в `README.md`/`TESTING.md` — лише лінкує. Діаграми — через скіл `mermaid-diagram`, ≤20 вузлів. | `Read, Grep, Glob, Bash, Write, Edit, Skill, AskUserQuestion` (обмеження запису лише в `docs/` — дисципліна промпту; технічно не enforced, див. джерела нижче) | sonnet | Джерело: `docs/<slug>-plan.md`, PR або commit range | Documentation Report (Placement Decision → Duplication Check → Diagrams → Docs Map → Not Verified) + сам документ у `docs/` |

## Джерела правил: `planner` та `implementer`

Обидва агенти спроєктовані як пара — `planner` виробляє контракт
(Development Plan), яким потім зв'язаний `implementer`, тож їхні правила
свідомо узгоджені одне з одним. Джерела:

- **Design-доки цього репозиторію** — повний why-контекст і рішення, з
  яких виведено кожен пункт системного промпту:
  - [`docs/agents/planner-agent-plan.md`](../../docs/agents/planner-agent-plan.md)
  - [`docs/agents/implementer-agent-plan.md`](../../docs/agents/implementer-agent-plan.md)
- **Anthropic, "Subagents"** (code.claude.com/docs/en/sub-agents) —
  single-responsibility + least-privilege tool scoping (звідси різні
  набори `tools:` у кожного агента) та факт, що субагент стартує з
  чистим, ізольованим контекстом — тому план мусить бути самодостатнім
  артефактом, а не покладатися на "пам'ять" спільної розмови.
- **Anthropic, "Best practices"** (code.claude.com/docs/en/best-practices)
  — розділення writer/reviewer і патерн adversarial review: свіжий
  контекст перевіряє диф проти плану, тож власна самоперевірка
  `implementer` навмисно обмежена тестами/білдом (pass/fail сигнал), а не
  судженнями.
- **Runtime-дискавері скілів через `Skill`-тул** — каталог скілів не
  захардкожено в жодному з промптів, обидва агенти читають
  `.claude/skills/README.md` і викликають `Skill` на льоту, тож каталог
  може рости без правок `planner.md`/`implementer.md`.
- **Конвенції кореневого [`CLAUDE.md`](../../CLAUDE.md)** — план
  зберігається як `docs/<slug>-plan.md` зі `**Status:**`; git
  commit/push/PR лишаються session-level діями, не делеговані
  агентам.

`researcher` таких зовнішніх джерел не має — його дизайн описано лише в
`docs/agents/resercher-agent-plan.md`, окремого запиту на цитування для
нього не було.

## Джерела правил: `test-writer`, `architecture-reviewer`, `plan-verifier`, `doc-writer`

Усі чотири спроєктовані через `planner`-агента (не вручну): для кожного —
паралельне зовнішнє дослідження (`researcher`, без WebFetch/WebSearch у
самого `planner`) + внутрішній репо-контекст, зведені в одне
`planner`-виконання. Design-доки з повним ланцюжком доказів:

- [`docs/agents/test-writer-agent-plan.md`](../../docs/agents/test-writer-agent-plan.md)
- [`docs/agents/architecture-reviewer-agent-plan.md`](../../docs/agents/architecture-reviewer-agent-plan.md)
- [`docs/agents/plan-verifier-agent-plan.md`](../../docs/agents/plan-verifier-agent-plan.md)
- [`docs/agents/doc-writer-agent-plan.md`](../../docs/agents/doc-writer-agent-plan.md)

Ключові зовнішні джерела, використані при проєктуванні:

- **Anthropic, "Best practices"** (code.claude.com/docs/en/best-practices)
  — паттерн adversarial review ("Use a subagent to review the diff against
  PLAN.md... Report gaps, not style preferences") — пряма основа
  `plan-verifier`; "give Claude a way to verify its work" — основа
  self-verification у `test-writer`.
  Anthropic, "Subagents" (code.claude.com/docs/en/sub-agents) —
  least-privilege tool scoping (`architecture-reviewer`/`plan-verifier` без
  Write/Edit).
- **Anthropic, "Configure permissions"**
  (code.claude.com/docs/en/permissions) — знайдений ґотча: `Write(docs/**)`
  тихо ігнорується permission-engine, перевіряється лише `Edit(path)` —
  причина, чому `doc-writer`'s обмеження на `docs/` лишається дисципліною
  промпту, а не технічним гарантом (відкрите питання, не вирішене цим
  раундом).
- **arXiv 2606.14948** ("Architecture Quality Judge") — вимога доказу +
  confidence на кожну заяву, незалежна оцінка по осі, перелік усіх
  розбіжностей замість бінарного pass/fail — основа `architecture-reviewer`'s
  analysis discipline.
- **arXiv 2511.16858, arXiv 2602.00409, CodeIntelligently** — задокументовані
  pitfalls LLM-згенерованих тестів (overfitting, over-mocking, mirror
  tests) — основа `test-writer`'s "Grounding tests against real behavior".
- **Augment Code / Galileo / Evidently AI / BrainGrid** — self-preference
  bias у LLM-рев'ю, LLM-as-judge pitfalls, і критерій верифіковності
  ("could two people disagree on whether it passed?") — основа
  `plan-verifier`'s UNVERIFIABLE-вердикту.
- **Diátaxis** (diataxis.fr) — класифікація документації за потребою
  читача (tutorial/how-to/reference/explanation) — основа `doc-writer`'s
  placement-евристики (документація вже реалізованої фічі → reference/
  explanation, ніколи tutorial/how-to).

Повний перелік джерел і цитат — у відповідному `docs/agents/*-agent-plan.md`.
