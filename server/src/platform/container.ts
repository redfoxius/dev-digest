import type {
  AuthProvider,
  SecretsProvider,
  GitHubClient,
  GitClient,
  CodeIndex,
  Embedder,
  LLMProvider,
  UrlFetcher,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db } from '../db/client.js';
import { JobRunner } from './jobs.js';
import { runBus, type RunBus } from './sse.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { RipgrepCodeIndex } from '../adapters/codeindex/ripgrep.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { AnthropicProvider } from '../adapters/llm/anthropic.js';
import { OpenAIEmbedder } from '../adapters/embedder/openai.js';
import { HttpUrlFetcher } from '../adapters/url-fetcher/http.js';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { estimateCost } from '../adapters/llm/pricing.js';
import { PriceBook } from './price-book.js';
import { ConfigError } from './errors.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import { ReviewRepository } from '../modules/reviews/repository.js';
import { SkillsRepository } from '../modules/skills/repository.js';
import { RepoRepository } from '../modules/repos/repository.js';
import { ContextDocsRepository } from '../modules/context-docs/repository.js';
import { RiskBriefRepository } from '../modules/risk-brief/repository.js';
import type { RepoIntel } from '../modules/repo-intel/types.js';
import { RepoIntelService } from '../modules/repo-intel/service.js';
import type { IntentDeriver } from '../modules/intent/types.js';
import { IntentDeriverService } from '../modules/intent/service.js';
import type { PullsSync } from '../modules/pulls/service.js';
import { PullsSyncService } from '../modules/pulls/service.js';
import type { DepGraph } from '../adapters/depgraph/index.js';
import { UnionDepGraph } from '../adapters/depgraph/union.js';
import { type Tokenizer, TiktokenTokenizer } from '../adapters/tokenizer/index.js';

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /** Intent Layer — tests inject mock IntentDeriver implementations. */
  intentDeriver?: IntentDeriver;
  /** Layer 2 PR diff self-heal — tests inject mock PullsSync implementations. */
  pullsSync?: PullsSync;
  /** repo-intel T3 adapters — only the indexer pipeline reads these. */
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
  urlFetcher?: UrlFetcher;
}

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  private _git?: GitClient;
  private _github?: GitHubClient;
  private _codeIndex?: CodeIndex;
  private _embedder?: Embedder;
  private llmCache = new Map<string, LLMProvider>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs, skills). Constructed here, in the composition root, so consuming
  // modules use `container.agentsRepo` instead of reaching into another
  // module's folder.
  private _agentsRepo?: AgentsRepository;
  private _reviewRepo?: ReviewRepository;
  private _skillsRepo?: SkillsRepository;
  private _reposRepo?: RepoRepository;
  private _contextDocsRepo?: ContextDocsRepository;
  private _riskBriefRepo?: RiskBriefRepository;
  private _repoIntel?: RepoIntel;
  private _intentDeriver?: IntentDeriver;
  private _pullsSync?: PullsSync;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _priceBook?: PriceBook;
  private _urlFetcher?: UrlFetcher;

  constructor(config: AppConfig, db: Db, private overrides: ContainerOverrides = {}) {
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
    this.runBus = runBus;
    this.jobs = new JobRunner(db);
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir);
    return this._git;
  }

  get agentsRepo(): AgentsRepository {
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  get skillsRepo(): SkillsRepository {
    return (this._skillsRepo ??= new SkillsRepository(this.db));
  }

  get reposRepo(): RepoRepository {
    return (this._reposRepo ??= new RepoRepository(this.db));
  }

  /**
   * Project Context Folder (`docs/project-context-folder-plan.md` Work Item
   * 3) — `context_documents`/`code_chunks` data access, for OTHER modules'
   * cross-reads (this module's own `service.ts` constructs its own instance
   * directly, same convention as `RepoService`/`AgentsService`).
   */
  get contextDocsRepo(): ContextDocsRepository {
    return (this._contextDocsRepo ??= new ContextDocsRepository(this.db));
  }

  /**
   * PR Why + Risk Brief (`specs/cross-cutting/pr-why-risk-brief/plan.md`) —
   * persisted `risk_brief` data access, for OTHER modules' cross-reads (e.g.
   * `pulls/routes.ts`'s PR Brief aggregate). Same convention as
   * `contextDocsRepo` above: this module's own `service.ts`
   * (`RiskBriefService`) constructs its own instance directly.
   */
  get riskBriefRepo(): RiskBriefRepository {
    return (this._riskBriefRepo ??= new RiskBriefRepository(this.db));
  }

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /**
   * Intent Layer — derives a PR's intent/scope (cheap-model LLM + GitHub +
   * UrlFetcher + a DB read). Modeled on `repoIntel` above: a cross-module
   * capability composing several ports, wired here so it stays swappable via
   * `ContainerOverrides` in unit tests instead of being constructed inline in
   * `run-executor.ts`/`reviews/service.ts`.
   */
  get intentDeriver(): IntentDeriver {
    if (this.overrides.intentDeriver) return this.overrides.intentDeriver;
    this._intentDeriver ??= new IntentDeriverService(this);
    return this._intentDeriver;
  }

  /**
   * Layer 2 (PR diff self-heal, docs/pr-diff-reindex-plan.md) — live GitHub
   * refresh of a PR's persisted files/commits/body/diff-stats. Modeled on
   * `repoIntel`/`intentDeriver` above: a cross-module orchestration
   * capability (a port + a private repository) wired here so
   * `diff-loader.ts` and `pulls/routes.ts` both call
   * `container.pullsSync.refreshFromGitHub(...)` instead of one importing
   * the other's `service.ts` directly, and so it stays swappable via
   * `ContainerOverrides` in unit tests.
   */
  get pullsSync(): PullsSync {
    if (this.overrides.pullsSync) return this.overrides.pullsSync;
    this._pullsSync ??= new PullsSyncService(this);
    return this._pullsSync;
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new UnionDepGraph();
    return this._depgraph;
  }

  /** Token counter (js-tiktoken) for the repo-map budget search. */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /**
   * Server-side fetch of a caller-supplied URL (skills import-from-URL).
   * The concrete adapter enforces the SSRF guard (http(s)-only, no private/
   * loopback/link-local targets, no redirects, a hard timeout) — that
   * belongs here, not in the service, so it's swappable via
   * `ContainerOverrides` like every other external call in this codebase.
   */
  get urlFetcher(): UrlFetcher {
    if (this.overrides.urlFetcher) return this.overrides.urlFetcher;
    this._urlFetcher ??= new HttpUrlFetcher();
    return this._urlFetcher;
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for OpenAI/Anthropic and a cold/cold-failed cache.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get('OPENROUTER_API_KEY');
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token);
    return this._github;
  }

  /** Resolve an LLM provider by id; constructs from the secret key, cached. */
  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  private async buildLlm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    if (id === 'openai') {
      const key = await this.secrets.get('OPENAI_API_KEY');
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key);
    }
    if (id === 'openrouter') {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = await this.secrets.get('OPENROUTER_API_KEY');
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new OpenRouterProvider(key, {
        estimateCost: (model, tokensIn, tokensOut) =>
          this.priceBook.estimate(model, tokensIn, tokensOut),
      });
    }
    const key = await this.secrets.get('ANTHROPIC_API_KEY');
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    return new AnthropicProvider(key);
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }
}
