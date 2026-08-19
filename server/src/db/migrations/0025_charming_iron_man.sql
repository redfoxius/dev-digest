CREATE TABLE "agent_context_docs" (
	"agent_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "agent_context_docs_agent_id_repo_id_path_pk" PRIMARY KEY("agent_id","repo_id","path")
);
--> statement-breakpoint
CREATE TABLE "context_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"root" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_hash" text NOT NULL,
	"chunk_count" integer,
	"index_status" text NOT NULL,
	"last_indexed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_context_docs" (
	"skill_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "skill_context_docs_skill_id_repo_id_path_pk" PRIMARY KEY("skill_id","repo_id","path")
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "context_search_globs" text[];--> statement-breakpoint
ALTER TABLE "agent_context_docs" ADD CONSTRAINT "agent_context_docs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_context_docs" ADD CONSTRAINT "agent_context_docs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_documents" ADD CONSTRAINT "context_documents_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_docs" ADD CONSTRAINT "skill_context_docs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_docs" ADD CONSTRAINT "skill_context_docs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "context_documents_repo_path_uq" ON "context_documents" USING btree ("repo_id","path");