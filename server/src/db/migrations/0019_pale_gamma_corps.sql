ALTER TABLE "pr_intent" ALTER COLUMN "confidence" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "pr_intent" ALTER COLUMN "evidence_tier" SET DEFAULT 'indirect_only';--> statement-breakpoint
CREATE INDEX "pr_commits_pr_id_idx" ON "pr_commits" USING btree ("pr_id");