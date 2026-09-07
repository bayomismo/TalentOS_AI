-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "analyzedAt" TIMESTAMP(3),
ADD COLUMN     "concerns" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "gaps" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "matchScore" INTEGER,
ADD COLUMN     "matchScoreBreakdown" JSONB,
ADD COLUMN     "recommendation" TEXT,
ADD COLUMN     "recommendationReasoning" TEXT,
ADD COLUMN     "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[];
