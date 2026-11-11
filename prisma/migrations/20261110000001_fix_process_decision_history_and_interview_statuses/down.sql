-- Rollback of: 20261110000001_fix_process_decision_history_and_interview_statuses
--
--   - Re-creates the UNIQUE constraint on (candidateId, hiringRequestId).
--     WARNING: this FAILS when a candidate has more than one decision
--     for the same hiring request — which is exactly what the append-only
--     log allows. De-duplicate first (keep the newest row per pair and
--     null out the older rows' supersedesId) if you must roll back.
--   - Removes the two ActivityType values. PostgreSQL cannot remove an
--     enum value, so the enum is rebuilt without them. Rows that used
--     them are re-labelled INTERVIEW_CANCELLED / INTERVIEW_SCHEDULED
--     first so the rebuild cannot fail.

-- -----------------------------------------------------------------------------
-- 1. Re-label the activities that use the new enum values
-- -----------------------------------------------------------------------------
UPDATE "Activity" SET "type" = 'INTERVIEW_SCHEDULED' WHERE "type" = 'INTERVIEW_RESCHEDULED';
UPDATE "Activity" SET "type" = 'INTERVIEW_CANCELLED' WHERE "type" = 'INTERVIEW_NO_SHOW';

-- -----------------------------------------------------------------------------
-- 2. Rebuild the enum without the two added values
-- -----------------------------------------------------------------------------
ALTER TYPE "ActivityType" RENAME TO "ActivityType_old";

CREATE TYPE "ActivityType" AS ENUM (
    'APPLICATION_RECEIVED',
    'CANDIDATE_MOVED',
    'CANDIDATE_ADDED',
    'PUBLIC_APPLICATION',
    'INTERVIEW_SCHEDULED',
    'INTERVIEW_COMPLETED',
    'INTERVIEW_CANCELLED',
    'OFFER_EXTENDED',
    'OFFER_ACCEPTED',
    'OFFER_DECLINED',
    'HIRED',
    'REJECTED',
    'NOTE_ADDED',
    'ATTACHMENT_ADDED',
    'HIRING_REQUEST_CREATED',
    'HIRING_REQUEST_UPDATED',
    'HIRING_REQUEST_CLOSED',
    'AI_TASK_STARTED',
    'AI_TASK_COMPLETED',
    'INTERVIEW_KIT_GENERATED',
    'EVALUATION_SUBMITTED',
    'DECISION_BRIEF_GENERATED',
    'COMPARISON_VIEWED',
    'CANDIDATE_SELECTED',
    'CANDIDATE_HELD',
    'CANDIDATE_REJECTED',
    'CANDIDATE_ADVANCED',
    'OFFER_CREATED',
    'OFFER_DRAFT_GENERATED',
    'OFFER_EDITED',
    'OFFER_SUBMITTED_FOR_APPROVAL',
    'OFFER_RETURNED_FOR_CHANGES',
    'OFFER_APPROVED',
    'OFFER_ISSUED',
    'OFFER_WITHDRAWN',
    'OFFER_EXPIRED'
);

ALTER TABLE "Activity" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Activity"
    ALTER COLUMN "type" TYPE "ActivityType"
    USING ("type"::text::"ActivityType");
ALTER TABLE "Activity" ALTER COLUMN "type" SET DEFAULT 'CANDIDATE_ADDED';

DROP TYPE "ActivityType_old";

-- -----------------------------------------------------------------------------
-- 3. Restore the UNIQUE constraint
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS "CandidateDecision_candidateId_hiringRequestId_idx";

CREATE UNIQUE INDEX "CandidateDecision_candidateId_hiringRequestId_key"
    ON "CandidateDecision"("candidateId", "hiringRequestId");
