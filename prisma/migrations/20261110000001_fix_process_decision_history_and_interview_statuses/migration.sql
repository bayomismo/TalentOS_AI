-- Sprint 19 — fix-process track: append-only decision log + reachable
-- interview lifecycle statuses.
--
-- REMEDIATION
--   audit P2-18 → the CandidateDecision log becomes APPEND-ONLY.
--                 The unique constraint on (candidateId, hiringRequestId)
--                 forced every re-decision to overwrite the previous row,
--                 which destroyed the history the Decision Brief is built
--                 on and let a decision point at itself as its own
--                 predecessor. It is replaced by a plain index; the rows
--                 are chained with "CandidateDecision.supersedesId",
--                 which the previous migration already added.
--   audit P1-08 → the ActivityType enum gains the two missing lifecycle
--                 entries (INTERVIEW_RESCHEDULED, INTERVIEW_NO_SHOW) so
--                 the newly reachable interview transitions leave a
--                 timeline entry.
--
-- SAFETY
--   - No column, table or row is dropped, renamed or retyped.
--   - The index swap is metadata-only and keeps the same columns in the
--     same order, so the existing index is simply relaxed from UNIQUE.
--   - The two enum values are appended; no existing value is touched and
--     no existing row is rewritten.
--   - Every statement is idempotent (IF EXISTS / IF NOT EXISTS), so the
--     file can be applied more than once safely.
--
--   The matching rollback is in `down.sql` in this folder.

-- -----------------------------------------------------------------------------
-- 1. CandidateDecision — append-only decision log (P2-18)
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS "CandidateDecision_candidateId_hiringRequestId_key";

CREATE INDEX IF NOT EXISTS "CandidateDecision_candidateId_hiringRequestId_idx"
    ON "CandidateDecision"("candidateId", "hiringRequestId");

-- -----------------------------------------------------------------------------
-- 2. ActivityType — the missing interview lifecycle entries (P1-08)
--
--    ALTER TYPE ... ADD VALUE cannot run inside a transaction block that
--    later uses the new value, so each statement stands alone.
-- -----------------------------------------------------------------------------
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'INTERVIEW_RESCHEDULED';

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'INTERVIEW_NO_SHOW';
