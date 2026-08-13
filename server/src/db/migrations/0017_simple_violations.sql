ALTER TABLE "findings" ADD COLUMN "in_scope" boolean;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "confidence" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "evidence_tier" text DEFAULT 'indirect_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD CONSTRAINT "pr_intent_confidence_range" CHECK ("pr_intent"."confidence" >= 0 AND "pr_intent"."confidence" <= 1) NOT VALID;--> statement-breakpoint
ALTER TABLE "pr_intent" VALIDATE CONSTRAINT "pr_intent_confidence_range";