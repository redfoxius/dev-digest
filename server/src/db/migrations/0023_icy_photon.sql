CREATE TABLE "review_file_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"file" text NOT NULL,
	"summary" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_file_summaries" ADD CONSTRAINT "review_file_summaries_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_file_summaries_review_id_idx" ON "review_file_summaries" USING btree ("review_id");