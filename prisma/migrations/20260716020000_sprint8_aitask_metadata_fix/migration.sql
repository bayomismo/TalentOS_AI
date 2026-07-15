-- Sprint 8 follow-up: ensure AITask.metadata exists.
-- The previous migration was applied against a connection that hadn't
-- seen the schema yet, so the column was not actually added.
ALTER TABLE "AITask" ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb;
