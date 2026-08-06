# Frontend UI Architecture — Examples

Companion to [SKILL.md](SKILL.md). Where possible these are drawn from
real files in this repo rather than invented, so they stay honest about
what "following the convention" looks like in practice.

## Component Folder Anatomy

Canonical example: `client/src/app/agents/_components/AgentCard/`.

```
AgentCard/
├── AgentCard.tsx        # component
├── AgentCard.test.tsx
├── index.ts              # single re-export
├── constants.ts           # MODEL_COLOR map
└── helpers.ts               # modelColor() — uses constants.ts
```

`index.ts` — the safe barrel shape (one named re-export, doubles as default):

```ts
export { AgentCard, AgentCard as default } from "./AgentCard";
```

`helpers.ts` — colocated, component-scoped, not meant to be imported
elsewhere:

```ts
import { MODEL_COLOR } from "./constants";

export function modelColor(model: string): string {
  return MODEL_COLOR[model] ?? "var(--text-secondary)";
}
```

A larger component nests its own `_components/` instead of flattening —
see `RunTraceDrawer/_components/{PromptBlock,TraceBody,ToolCallRow,...}/`.

## Constants: Colocate First, Promote Once Reused

**Wrong — pre-creating a global layer before it's earned:**

```
src/
└── constants/
    ├── agents.ts       # only AgentCard uses these
    ├── findings.ts     # only FindingCard uses these
    └── verdicts.ts     # only VerdictBanner uses these
```

Nothing here is actually shared — it's one file per component, just
moved away from the component that owns it. Now editing `AgentCard`
means opening two folders instead of one.

**Right — colocate, promote only when 2+ consumers need it:**

```
app/agents/_components/AgentCard/constants.ts       # MODEL_COLOR — used only here
app/repos/.../FindingCard/constants.ts               # used only here
```

If a value like a shared severity color scale later needs both
`FindingCard` and `VerdictBanner`, *then* it moves to `lib/` — named for
what it is (`lib/severity-colors.ts`), not dumped into a generic
`constants.ts`.

## Utils vs Helpers vs Services

**Wrong — a junk-drawer `utils.ts` growing unrelated functions:**

```ts
// lib/utils.ts
export function formatDate(d: Date) { /* ... */ }
export function buildGithubUrl(repo: string, path: string) { /* ... */ }
export function modelColor(model: string) { /* ... */ }   // only AgentCard uses this!
export function debounce(fn: Function, ms: number) { /* ... */ }
```

Mixed scope (generic + component-specific), mixed domain (dates, URLs,
UI color), one file everyone touches → constant merge conflicts.

**Right — this repo's actual split:**

```ts
// lib/format.ts — generic, reusable, named for what it does
export function formatDate(d: Date) { /* ... */ }

// lib/github-urls.ts — generic, reusable, named for what it does
export function buildGithubUrl(repo: string, path: string) { /* ... */ }

// app/agents/_components/AgentCard/helpers.ts — component-scoped, not exported beyond the folder
export function modelColor(model: string) { /* ... */ }
```

No `services/` folder — instead:

```ts
// lib/api.ts — the ONLY module that knows NEXT_PUBLIC_API_BASE
export async function apiFetch(path: string, init?: RequestInit) { /* ... */ }
```

```ts
// lib/hooks/agents.ts — one file per API domain, wraps lib/api.ts in TanStack Query
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => apiFetch("/agents"),
  });
}
```

## Business Logic: Hook, Not Component Body

**Wrong — fetch and business logic inline in the component:**

```tsx
function AgentsListView() {
  const [agents, setAgents] = useState([]);
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_BASE}/agents`)
      .then((r) => r.json())
      .then(setAgents);
  }, []);
  // ...render
}
```

Two violations at once: `fetch` outside `lib/api.ts`, and data-fetching
logic inline instead of in a hook.

**Right:**

```tsx
import { useAgents } from "@/lib/hooks/agents";

function AgentsListView() {
  const { data: agents } = useAgents();
  // ...render
}
```

## Barrel Files: Two Different Risk Profiles

**Safe — single re-export, this repo's default (40+ instances):**

```ts
// app/agents/_components/AgentCard/index.ts
export { AgentCard, AgentCard as default } from "./AgentCard";
```

One module, one export. No wildcard, nothing to tree-shake incorrectly,
nothing to create a circular-dependency hotspot.

**Use sparingly — wildcard aggregation, exactly one deliberate instance:**

```ts
// lib/hooks/index.ts
/* hooks/ barrel — every React Query hook over the F1/feature APIs.
   Import from "@/lib/hooks" for the platform hooks (settings/repos/pulls/context)
   or from a domain file directly (e.g. "@/lib/hooks/reviews") — both resolve here. */
export * from "./core";
export * from "./agents";
export * from "./reviews";
export * from "./trace";
export * from "./repo-intel";
```

This is the pattern TkDodo's article warns about (module-graph fan-out,
harder tree-shaking) — it's tolerated here because there's exactly one
of it, it's small (5 files), and the comment documents *why* both import
paths need to work. Don't add a second wildcard barrel like this for a
new domain — prefer `import { useX } from "@/lib/hooks/x"` directly.

## Next.js: `lib/api.ts` as the DAL-Equivalent Boundary

A real Next.js Data Access Layer (Server Component reading a DB
directly) looks like this:

```ts
// lib/dal/posts.ts (NOT this repo's pattern — shown for contrast)
import "server-only";

export async function getPost(id: string) {
  const session = await verifySession();      // auth check inside the DAL
  if (!session) throw new Error("Unauthorized");

  const post = await db.post.findUnique({ where: { id } });
  return { id: post.id, title: post.title };    // DTO, not the raw ORM row
}
```

This repo's `client/` never reads a database — it calls `server/`'s API.
The equivalent enforcement point is narrower but plays the same role:

```ts
// lib/api.ts — the one module allowed to know the API base URL
const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

export async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
```

Everything else — components, hooks, Server Actions if this repo adds
them later — calls through `apiFetch`, never `fetch` directly against the
API base.
