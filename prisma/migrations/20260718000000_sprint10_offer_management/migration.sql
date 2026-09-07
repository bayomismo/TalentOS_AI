-- Sprint 10 — Offer Management & AI Offer Drafting
-- Safe additive migration. No destructive operations. All existing rows preserved.
-- Backward compatibility note: existing SENT/UNDER_REVIEW offers are preserved
-- and their semantics are not reinterpreted. New statuses PENDING_APPROVAL,
-- APPROVED, ISSUED are additive.

-- -----------------------------------------------------------------------------
-- 1. Extend OfferStatus enum (additive, preserves existing SENT/UNDER_REVIEW)
-- -----------------------------------------------------------------------------
ALTER TYPE "OfferStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "OfferStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "OfferStatus" ADD VALUE IF NOT EXISTS 'ISSUED';

-- -----------------------------------------------------------------------------
-- 2. Extend AITaskType enum — add OFFER_LETTER
-- -----------------------------------------------------------------------------
ALTER TYPE "AITaskType" ADD VALUE IF NOT EXISTS 'OFFER_LETTER';

-- -----------------------------------------------------------------------------
-- 3. Extend ActivityType enum — add offer lifecycle events
--    (OFFER_EXTENDED, OFFER_ACCEPTED, OFFER_DECLINED already exist from Sprint 3)
-- -----------------------------------------------------------------------------
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'OFFER_CREATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'OFFER_DRAFT_GENERATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'OFFER_EDITED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'OFFER_SUBMITTED_FOR_APPROVAL';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'OFFER_RETURNED_FOR_CHANGES';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'OFFER_APPROVED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'OFFER_ISSUED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'OFFER_WITHDRAWN';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'OFFER_EXPIRED';

-- -----------------------------------------------------------------------------
-- 4. Extend Offer model — add workflow + actor + content fields
--    (all nullable for backward compatibility with the 1 existing SENT row)
-- -----------------------------------------------------------------------------
ALTER TABLE "Offer" ADD COLUMN "createdById" UUID;
ALTER TABLE "Offer" ADD COLUMN "approvedById" UUID;
ALTER TABLE "Offer" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "Offer" ADD COLUMN "issuedById" UUID;
ALTER TABLE "Offer" ADD COLUMN "issuedAt" TIMESTAMP(3);
ALTER TABLE "Offer" ADD COLUMN "withdrawnAt" TIMESTAMP(3);
ALTER TABLE "Offer" ADD COLUMN "withdrawnReason" TEXT;
ALTER TABLE "Offer" ADD COLUMN "expiredAt" TIMESTAMP(3);
ALTER TABLE "Offer" ADD COLUMN "employmentType" TEXT;
ALTER TABLE "Offer" ADD COLUMN "workArrangement" TEXT;
ALTER TABLE "Offer" ADD COLUMN "probationPeriodDays" INTEGER;
ALTER TABLE "Offer" ADD COLUMN "noticePeriodDays" INTEGER;
ALTER TABLE "Offer" ADD COLUMN "vacationDays" INTEGER;
ALTER TABLE "Offer" ADD COLUMN "commissionAmount" INTEGER;
ALTER TABLE "Offer" ADD COLUMN "benefits" TEXT;
ALTER TABLE "Offer" ADD COLUMN "additionalTerms" TEXT;
ALTER TABLE "Offer" ADD COLUMN "draftContent" JSONB;
ALTER TABLE "Offer" ADD COLUMN "aiGeneratedAt" TIMESTAMP(3);
ALTER TABLE "Offer" ADD COLUMN "aiTaskId" UUID;
ALTER TABLE "Offer" ADD COLUMN "aiPromptVersion" TEXT;
ALTER TABLE "Offer" ADD COLUMN "aiModelUsed" TEXT;

-- Indexes for the new actor FKs + status-based queries
CREATE INDEX IF NOT EXISTS "Offer_createdById_idx" ON "Offer"("createdById");
CREATE INDEX IF NOT EXISTS "Offer_approvedById_idx" ON "Offer"("approvedById");
CREATE INDEX IF NOT EXISTS "Offer_issuedById_idx" ON "Offer"("issuedById");
CREATE INDEX IF NOT EXISTS "Offer_aiTaskId_idx" ON "Offer"("aiTaskId");

-- Composite index for the duplicate-active-offer guard
-- (candidateId + hiringRequestId + status) at production scale
CREATE INDEX IF NOT EXISTS "Offer_candidateId_hiringRequestId_status_idx"
  ON "Offer"("candidateId", "hiringRequestId", "status");

-- FKs (additive, not enforced as NOT NULL to preserve the 1 existing SENT row
-- which has no creator/approver/issuer). The application layer enforces these
-- going forward via required field validation.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Offer_createdById_fkey') THEN
    ALTER TABLE "Offer" ADD CONSTRAINT "Offer_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Offer_approvedById_fkey') THEN
    ALTER TABLE "Offer" ADD CONSTRAINT "Offer_approvedById_fkey"
      FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Offer_issuedById_fkey') THEN
    ALTER TABLE "Offer" ADD CONSTRAINT "Offer_issuedById_fkey"
      FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Offer_aiTaskId_fkey') THEN
    ALTER TABLE "Offer" ADD CONSTRAINT "Offer_aiTaskId_fkey"
      FOREIGN KEY ("aiTaskId") REFERENCES "AITask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
