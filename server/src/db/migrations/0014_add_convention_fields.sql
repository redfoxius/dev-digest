ALTER TABLE "conventions" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_line_start" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_line_end" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "origin" text DEFAULT 'model' NOT NULL;--> statement-breakpoint
UPDATE "conventions" SET "status" = 'accepted' WHERE "accepted" = true;--> statement-breakpoint
ALTER TABLE "conventions" DROP COLUMN "accepted";
