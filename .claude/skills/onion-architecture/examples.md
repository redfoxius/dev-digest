# Examples

## 1. A compliant module slice (`modules/reviews/*`)

`routes.ts` — validates, delegates, shapes the response. No business logic:

```ts
// server/src/modules/reviews/routes.ts
app.post(
  '/pulls/:id/review',
  { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
  async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = RunRequest.parse(req.body ?? {});
    const targets = await service.resolveTargets(workspaceId, { ... });
    const { runs, reviews } = await service.runReview(workspaceId, req.params.id, targets, req.log);
    return { pr_id: req.params.id, runs, reviews };
  },
);
```

`service.ts` — orchestrates the use case via the repository and the
container's ports; never touches Drizzle or Fastify types directly:

```ts
// server/src/modules/reviews/service.ts
export class ReviewService {
  private repo: ReviewRepository;
  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  async runReview(workspaceId: string, prId: string, targets: AgentRow[], logger?: Logger) {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    // ...orchestration only — no SQL, no HTTP details here
  }
}
```

`repository.ts` — the only file that imports the Drizzle schema for this
domain; returns row/DTO shapes, not query builders:

```ts
// server/src/modules/reviews/repository.ts
import * as t from '../../db/schema.js';
export type ReviewRow = typeof t.reviews.$inferSelect;

export class ReviewRepository {
  constructor(private db: Db) {}
  getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    return pullRepo.getPull(this.db, workspaceId, prId);
  }
}
```

## 2. Ports & the composition root (`platform/container.ts`)

Port interface (`server/src/vendor/shared/adapters.ts`):

```ts
export interface GitHubClient {
  listPullRequests(repo: RepoRef): Promise<PrMeta[]>;
  getPullRequest(repo: RepoRef, n: number): Promise<PrDetail>;
  // ...
}
```

The concrete adapter (`server/src/adapters/github/octokit.ts`) implements it.
`container.ts` is the *only* place it gets constructed:

```ts
// server/src/platform/container.ts
async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;
  if (this._github) return this._github;
  const token = await this.secrets.get('GITHUB_TOKEN');
  if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
  this._github = new OctokitGitHubClient(token);
  return this._github;
}
```

A service never does `new OctokitGitHubClient(...)` — it calls
`await container.github()` and gets back the interface type.

## 3. Domain purity (`reviewer-core`)

`reviewPullRequest()` — zero I/O beyond the injected `LLMProvider`:

```ts
// reviewer-core/src/review/run.ts
export interface ReviewInput {
  systemPrompt: string;
  model: string;
  diff: UnifiedDiff;
  /** Injected LLM provider (OpenRouter in CI, OpenAI/Anthropic in the studio). */
  llm: LLMProvider;
  // ...
}
```

The server's `ReviewRunExecutor` resolves a concrete `LLMProvider` from
`container.llm(...)` and passes it in — `reviewer-core` never knows whether
it's talking to OpenAI, Anthropic, or OpenRouter.

## 4. Before / after — adding a new module

Adding a hypothetical `webhooks` module that needs to verify a signature and
persist an event.

**Bad** — logic and Drizzle mixed into the route:

```ts
// ❌ modules/webhooks/routes.ts
app.post('/webhooks/github', async (req) => {
  const sig = req.headers['x-hub-signature-256'];
  const expected = crypto.createHmac('sha256', SECRET).update(req.rawBody).digest('hex');
  if (sig !== `sha256=${expected}`) throw new AppError('bad_signature', '', 401);

  await db.insert(t.webhookEvents).values({ payload: req.body }); // ❌ Drizzle in routes.ts
  return { ok: true };
});
```

**Good** — signature check + persistence pushed to their rings:

```ts
// ✅ modules/webhooks/routes.ts
app.post('/webhooks/github', { schema: { body: WebhookBody } }, async (req) => {
  await service.handleGitHubWebhook(req.headers, req.rawBody);
  return { ok: true };
});

// ✅ modules/webhooks/service.ts
export class WebhookService {
  constructor(private container: Container) {
    this.repo = new WebhookRepository(container.db);
  }
  async handleGitHubWebhook(headers: IncomingHttpHeaders, rawBody: Buffer) {
    if (!verifyGitHubSignature(headers, rawBody, this.container.config.webhookSecret)) {
      throw new AppError('bad_signature', 'Invalid webhook signature', 401);
    }
    await this.repo.insertEvent(JSON.parse(rawBody.toString()));
  }
}

// ✅ modules/webhooks/repository.ts
export class WebhookRepository {
  constructor(private db: Db) {}
  insertEvent(payload: unknown) {
    return this.db.insert(t.webhookEvents).values({ payload });
  }
}
```

`verifyGitHubSignature` is a pure function (no I/O) — it can live in
`service.ts` or a colocated `helpers.ts`, same as `reviews/helpers.ts`'s
`reviewToDto`.
