-- Sprint 19 — Business-flow audit fixes (ADDITIVE)
--
-- Remediation for the November 2026 business-flow audit:
--   P0-06 / P0-07 / P1-16  → new "Application" table
--   P1-03 (schema half)    → Offer.supersededAt
--   P1-06                  → InterviewEvaluation one-evaluation-per-interviewer
--   P1-11                  → JobDescription.publicHiringRequestId
--   P2-18                  → CandidateDecision.supersedesId
--   P0-03                  → EmailOutbox.provider / EmailOutbox.deliveryStatus
--
-- SAFETY
--   This migration is strictly ADDITIVE and is safe to run against live
--   data:
--     · no column, table, enum or enum value is dropped, renamed or
--       retyped;
--     · every new column is NULLABLE, so existing rows stay valid;
--     · the one new table ("Application") starts empty;
--     · the only data-modifying statement is the de-duplication below,
--       which runs BEFORE the unique constraint is added and keeps the
--       earliest evaluation per (interviewId, evaluatorId).
--
--   The matching rollback is in `down.sql` in this folder. It drops
--   exactly what this file creates — nothing else.
--
--   New foreign keys use ON DELETE CASCADE / ON UPDATE CASCADE to match
--   the style of the rest of the schema.

-- -----------------------------------------------------------------------------
-- 1. "Application" — the person × requisition record (P1-16, P0-06, P0-07)
--
--    "Candidate" stays the person. This table is that person's
--    application to ONE requisition, and it carries the per-application
--    stage, source, consent and match score.
-- -----------------------------------------------------------------------------
CREATE TABLE "Application" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId"  UUID NOT NULL,
    "candidateId"     UUID NOT NULL,
    "hiringRequestId" UUID NOT NULL,
    "stage"           "ApplicationStage" NOT NULL DEFAULT 'APPLIED',
    "source"          TEXT,
    "sourceDetails"   TEXT,
    "appliedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consentAt"       TIMESTAMP(3),
    "consentText"     TEXT,
    "matchScore"      INTEGER,
    "analyzedAt"      TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Application_organizationId_idx" ON "Application"("organizationId");

-- CreateIndex
CREATE INDEX "Application_hiringRequestId_stage_idx" ON "Application"("hiringRequestId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Application_candidateId_hiringRequestId_key" ON "Application"("candidateId", "hiringRequestId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_hiringRequestId_fkey" FOREIGN KEY ("hiringRequestId") REFERENCES "HiringRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 2. Offer.supersededAt — marks an offer replaced by a newer one (P2-29)
-- -----------------------------------------------------------------------------
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);

-- -----------------------------------------------------------------------------
-- 3. InterviewEvaluation — one evaluation per interviewer (P1-06)
--
--    De-duplicate FIRST: keep the row with the earliest submittedAt per
--    (interviewId, evaluatorId) and delete the rest. Without this the
--    constraint below would fail on any interview that was evaluated
--    more than once by the same interviewer.
-- -----------------------------------------------------------------------------
WITH ranked AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "interviewId", "evaluatorId"
            ORDER BY "submittedAt" ASC, "createdAt" ASC, "id" ASC
        ) AS rn
    FROM "InterviewEvaluation"
)
DELETE FROM "InterviewEvaluation" e
USING ranked r
WHERE e."id" = r."id" AND r.rn > 1;

-- AddConstraint
ALTER TABLE "InterviewEvaluation" ADD CONSTRAINT "InterviewEvaluation_interviewId_evaluatorId_key" UNIQUE ("interviewId","evaluatorId");

-- -----------------------------------------------------------------------------
-- 4. JobDescription.publicHiringRequestId — bind a public posting to ONE
--    deterministic requisition instead of resolving it with `take: 1` at
--    apply time (P1-11).
--
--    Unique because a requisition has at most one public posting. The
--    column stays nullable, so several postings may be unbound.
-- -----------------------------------------------------------------------------
ALTER TABLE "JobDescription" ADD COLUMN IF NOT EXISTS "publicHiringRequestId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JobDescription_publicHiringRequestId_key" ON "JobDescription"("publicHiringRequestId");

-- AddForeignKey
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_publicHiringRequestId_fkey" FOREIGN KEY ("publicHiringRequestId") REFERENCES "HiringRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 5. CandidateDecision.supersedesId — record what a re-decision replaced
--    instead of overwriting the previous decision silently (P2-18).
-- -----------------------------------------------------------------------------
ALTER TABLE "CandidateDecision" ADD COLUMN IF NOT EXISTS "supersedesId" UUID;

-- AddForeignKey
ALTER TABLE "CandidateDecision" ADD CONSTRAINT "CandidateDecision_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "CandidateDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 6. EmailOutbox.provider / EmailOutbox.deliveryStatus — let an admin see
--    what happened to each send (P0-03).
--
--    The existing "status" column is REUSED: it stays the row's own
--    lifecycle (PENDING → SENT | FAILED | SKIPPED). "provider" records
--    which provider handled the send ('local-outbox' | 'resend') and
--    "deliveryStatus" records what it did with it (QUEUED | DELIVERED |
--    FAILED), so "queued locally" is never confused with "delivered".
-- -----------------------------------------------------------------------------
ALTER TABLE "EmailOutbox" ADD COLUMN IF NOT EXISTS "provider" TEXT;

ALTER TABLE "EmailOutbox" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT;
