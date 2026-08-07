ALTER TABLE "skill_versions" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;