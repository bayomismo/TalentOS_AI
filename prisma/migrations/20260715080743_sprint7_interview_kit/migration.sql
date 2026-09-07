-- CreateEnum
CREATE TYPE "QuestionPurpose" AS ENUM ('OPENING', 'ROLE_SPECIFIC', 'SKILL_VALIDATION', 'GAP_VALIDATION', 'BEHAVIORAL', 'SCENARIO', 'CANDIDATE_SPECIFIC', 'CLOSING');

-- AlterEnum
ALTER TYPE "EvaluationRecommendation" ADD VALUE 'MIXED';

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "kitSnapshot" JSONB,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InterviewEvaluation" ADD COLUMN     "criterionScores" JSONB,
ADD COLUMN     "interviewScore" INTEGER,
ADD COLUMN     "overallNotes" TEXT;

-- AlterTable
ALTER TABLE "InterviewQuestion" ADD COLUMN     "purpose" "QuestionPurpose" NOT NULL DEFAULT 'ROLE_SPECIFIC',
ADD COLUMN     "redFlags" TEXT,
ADD COLUMN     "strongAnswerIndicators" TEXT,
ADD COLUMN     "suggestedFollowUp" TEXT,
ADD COLUMN     "whatItEvaluates" TEXT,
ADD COLUMN     "whyThisQuestion" TEXT;

-- CreateIndex
CREATE INDEX "InterviewQuestion_interviewId_purpose_idx" ON "InterviewQuestion"("interviewId", "purpose");
