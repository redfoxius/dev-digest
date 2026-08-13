-- Not CREATE INDEX CONCURRENTLY: Postgres forbids it inside a transaction
-- block, and drizzle-orm's migrator (pg-core/dialect.cjs) wraps every
-- migration in one shared transaction with no per-statement opt-out —
-- CONCURRENTLY here would make every `db:migrate` run fail outright.
CREATE INDEX "pr_commits_pr_id_idx" ON "pr_commits" USING btree ("pr_id");