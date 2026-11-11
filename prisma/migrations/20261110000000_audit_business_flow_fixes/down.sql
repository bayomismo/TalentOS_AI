-- Rollback for 20261110000000_audit_business_flow_fixes
--
-- Drops EXACTLY what `migration.sql` in this folder creates — nothing
-- else. Every statement is guarded with IF EXISTS so the rollback is
-- safe to run twice.
--
-- DESTRUCTIVE WARNING: this removes the "Application" table and every
-- application row in it, the one-evaluation-per-interviewer constraint
-- (and, with it, the ability to store a second evaluation by the same
-- interviewer), and the added columns. Run it only if the audit fixes
-- have to be reverted.

-- 1. "Application" (drops its own foreign keys with the table)
DROP TABLE IF EXISTS "Application";

-- 6. EmailOutbox
ALTER TABLE "EmailOutbox" DROP COLUMN IF EXISTS "deliveryStatus";
ALTER TABLE "EmailOutbox" DROP COLUMN IF EXISTS "provider";

-- 5. CandidateDecision.supersedesId
ALTER TABLE "CandidateDecision" DROP CONSTRAINT IF EXISTS "CandidateDecision_supersedesId_fkey";
ALTER TABLE "CandidateDecision" DROP COLUMN IF EXISTS "supersedesId";

-- 4. JobDescription.publicHiringRequestId
ALTER TABLE "JobDescription" DROP CONSTRAINT IF EXISTS "JobDescription_publicHiringRequestId_fkey";
DROP INDEX IF EXISTS "JobDescription_publicHiringRequestId_key";
ALTER TABLE "JobDescription" DROP COLUMN IF EXISTS "publicHiringRequestId";

-- 3. InterviewEvaluation unique constraint
ALTER TABLE "InterviewEvaluation" DROP CONSTRAINT IF EXISTS "InterviewEvaluation_interviewId_evaluatorId_key";

-- 2. Offer.supersededAt
ALTER TABLE "Offer" DROP COLUMN IF EXISTS "supersededAt";
