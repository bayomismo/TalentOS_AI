
-- CreateEnum
CREATE TYPE "DecisionValue" AS ENUM ('ADVANCE', 'HOLD', 'REJECT', 'SELECTED');

-- AlterEnum
ALTER TYPE "AITaskType" ADD VALUE 'DECISION_BRIEF';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'DECISION_BRIEF_GENERATED';
ALTER TYPE "ActivityType" ADD VALUE 'COMPARISON_VIEWED';
ALTER TYPE "ActivityType" ADD VALUE 'CANDIDATE_SELECTED';
ALTER TYPE "ActivityType" ADD VALUE 'CANDIDATE_HELD';
ALTER TYPE "ActivityType" ADD VALUE 'CANDIDATE_REJECTED';
ALTER TYPE "ActivityType" ADD VALUE 'CANDIDATE_ADVANCED';

-- AlterEnum

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "candidateDecisionId" UUID;

-- CreateTable
CREATE TABLE "CandidateDecision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "hiringRequestId" UUID NOT NULL,
    "decision" "DecisionValue" NOT NULL,
    "notes" TEXT,
    "reason" TEXT,
    "decidedById" UUID NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateDecision_organizationId_idx" ON "CandidateDecision"("organizationId");

-- CreateIndex
CREATE INDEX "CandidateDecision_hiringRequestId_decision_idx" ON "CandidateDecision"("hiringRequestId", "decision");

-- CreateIndex
CREATE INDEX "CandidateDecision_candidateId_idx" ON "CandidateDecision"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateDecision_candidateId_hiringRequestId_key" ON "CandidateDecision"("candidateId", "hiringRequestId");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_candidateDecisionId_fkey" FOREIGN KEY ("candidateDecisionId") REFERENCES "CandidateDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateDecision" ADD CONSTRAINT "CandidateDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateDecision" ADD CONSTRAINT "CandidateDecision_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateDecision" ADD CONSTRAINT "CandidateDecision_hiringRequestId_fkey" FOREIGN KEY ("hiringRequestId") REFERENCES "HiringRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateDecision" ADD CONSTRAINT "CandidateDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

