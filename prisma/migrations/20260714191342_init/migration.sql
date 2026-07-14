-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER', 'CANDIDATE');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "HiringRequestStatus" AS ENUM ('DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED', 'FILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "WorkArrangement" AS ENUM ('ONSITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "JobLevel" AS ENUM ('ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'STAFF', 'PRINCIPAL', 'LEAD', 'EXECUTIVE');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('ACTIVE', 'HIRED', 'REJECTED', 'WITHDRAWN', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "DegreeType" AS ENUM ('HIGH_SCHOOL', 'ASSOCIATE', 'BACHELOR', 'MASTER', 'PHD', 'BOOTCAMP', 'CERTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "InterviewType" AS ENUM ('PHONE_SCREEN', 'TECHNICAL', 'BEHAVIORAL', 'PANEL', 'ONSITE', 'FINAL', 'CULTURE_FIT', 'CASE_STUDY');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('TECHNICAL', 'BEHAVIORAL', 'SITUATIONAL', 'CULTURAL', 'CASE_STUDY', 'SYSTEM_DESIGN', 'CODING');

-- CreateEnum
CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'EXPERT');

-- CreateEnum
CREATE TYPE "EvaluationRecommendation" AS ENUM ('STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SENT', 'UNDER_REVIEW', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SalaryCurrency" AS ENUM ('USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'INR', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('APPLICATION_RECEIVED', 'CANDIDATE_MOVED', 'CANDIDATE_ADDED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'INTERVIEW_CANCELLED', 'OFFER_EXTENDED', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'HIRED', 'REJECTED', 'NOTE_ADDED', 'ATTACHMENT_ADDED', 'HIRING_REQUEST_CREATED', 'HIRING_REQUEST_UPDATED', 'HIRING_REQUEST_CLOSED', 'AI_TASK_STARTED', 'AI_TASK_COMPLETED');

-- CreateEnum
CREATE TYPE "AITaskType" AS ENUM ('JOB_DESCRIPTION', 'SKILLS_MATRIX', 'SCREENING_QUESTIONS', 'INTERVIEW_QUESTIONS', 'HIRING_PACKAGE', 'SCORECARD', 'OUTREACH', 'GENERIC');

-- CreateEnum
CREATE TYPE "AITaskStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AIConversationRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PromptTemplateCategory" AS ENUM ('JOB_DESCRIPTION', 'INTERVIEW', 'SCREENING', 'EVALUATION', 'OUTREACH', 'GENERIC');

-- CreateEnum
CREATE TYPE "CVFileType" AS ENUM ('PDF', 'DOC', 'DOCX', 'TXT', 'RTF', 'OTHER');

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "logoUrl" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "description" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "headUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "departmentId" UUID,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "jobTitle" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'RECRUITER',
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "phone" TEXT,
    "location" TEXT,
    "timezone" TEXT,
    "bio" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiringRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "hiringManagerId" UUID,
    "jobDescriptionId" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "HiringRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "jobType" "JobType" NOT NULL DEFAULT 'FULL_TIME',
    "workArrangement" "WorkArrangement" NOT NULL DEFAULT 'ONSITE',
    "level" "JobLevel" NOT NULL DEFAULT 'MID',
    "openings" INTEGER NOT NULL DEFAULT 1,
    "filled" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryCurrency" "SalaryCurrency" NOT NULL DEFAULT 'USD',
    "summary" TEXT,
    "targetStartDate" TIMESTAMP(3),
    "closingDate" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDescription" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "level" "JobLevel" NOT NULL DEFAULT 'MID',
    "jobType" "JobType" NOT NULL DEFAULT 'FULL_TIME',
    "summary" TEXT,
    "description" TEXT NOT NULL,
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "niceToHave" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "perks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "hiringRequestId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "location" TEXT,
    "timezone" TEXT,
    "linkedinUrl" TEXT,
    "githubUrl" TEXT,
    "portfolioUrl" TEXT,
    "avatarUrl" TEXT,
    "headline" TEXT,
    "summary" TEXT,
    "currentTitle" TEXT,
    "currentCompany" TEXT,
    "yearsExperience" INTEGER,
    "status" "CandidateStatus" NOT NULL DEFAULT 'ACTIVE',
    "stage" "ApplicationStage" NOT NULL DEFAULT 'APPLIED',
    "rating" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "sourceDetails" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejectedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "hiredAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateSkill" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidateId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "level" "SkillLevel" NOT NULL DEFAULT 'INTERMEDIATE',
    "yearsOfUse" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateExperience" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidateId" UUID NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateEducation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidateId" UUID NOT NULL,
    "institution" TEXT NOT NULL,
    "degree" "DegreeType" NOT NULL,
    "field" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "grade" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateEducation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateCertification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidateId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "credentialId" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CVFile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidateId" UUID NOT NULL,
    "fileType" "CVFileType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "storagePath" TEXT,
    "mimeType" TEXT,
    "parsedText" TEXT,
    "parsedData" JSONB,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CVFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "hiringRequestId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "scheduledById" UUID,
    "type" "InterviewType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "location" TEXT,
    "meetingUrl" TEXT,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'INTERVIEW',
    "round" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "cancelledReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewParticipant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "interviewId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewQuestion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "interviewId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL DEFAULT 'MEDIUM',
    "question" TEXT NOT NULL,
    "expectedAnswer" TEXT,
    "notes" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "askedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewEvaluation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "interviewId" UUID NOT NULL,
    "evaluatorId" UUID NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "technicalScore" INTEGER,
    "communicationScore" INTEGER,
    "cultureFitScore" INTEGER,
    "problemSolvingScore" INTEGER,
    "strengths" TEXT,
    "weaknesses" TEXT,
    "recommendation" "EvaluationRecommendation" NOT NULL,
    "summary" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "hiringRequestId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "salaryAmount" INTEGER NOT NULL,
    "salaryCurrency" "SalaryCurrency" NOT NULL DEFAULT 'USD',
    "salaryPeriod" TEXT NOT NULL DEFAULT 'annual',
    "bonusAmount" INTEGER,
    "equityAmount" TEXT,
    "startDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "notes" TEXT,
    "documentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "actorId" UUID,
    "candidateId" UUID,
    "hiringRequestId" UUID,
    "interviewId" UUID,
    "offerId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AITask" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "hiringRequestId" UUID,
    "jobDescriptionId" UUID,
    "createdById" UUID,
    "type" "AITaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AITaskStatus" NOT NULL DEFAULT 'PENDING',
    "prompt" TEXT NOT NULL,
    "result" JSONB,
    "errorMessage" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "modelUsed" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AITask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIConversation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "taskId" UUID NOT NULL,
    "role" "AIConversationRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tokens" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "PromptTemplateCategory" NOT NULL,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_domain_key" ON "Organization"("domain");

-- CreateIndex
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Department_organizationId_idx" ON "Department"("organizationId");

-- CreateIndex
CREATE INDEX "Department_organizationId_name_idx" ON "Department"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_organizationId_slug_key" ON "Department"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_organizationId_role_idx" ON "User"("organizationId", "role");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "HiringRequest_organizationId_status_idx" ON "HiringRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "HiringRequest_organizationId_departmentId_idx" ON "HiringRequest"("organizationId", "departmentId");

-- CreateIndex
CREATE INDEX "HiringRequest_departmentId_status_idx" ON "HiringRequest"("departmentId", "status");

-- CreateIndex
CREATE INDEX "HiringRequest_hiringManagerId_idx" ON "HiringRequest"("hiringManagerId");

-- CreateIndex
CREATE INDEX "HiringRequest_title_idx" ON "HiringRequest"("title");

-- CreateIndex
CREATE UNIQUE INDEX "HiringRequest_organizationId_slug_key" ON "HiringRequest"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "JobDescription_organizationId_isTemplate_idx" ON "JobDescription"("organizationId", "isTemplate");

-- CreateIndex
CREATE INDEX "JobDescription_organizationId_title_idx" ON "JobDescription"("organizationId", "title");

-- CreateIndex
CREATE INDEX "JobDescription_title_idx" ON "JobDescription"("title");

-- CreateIndex
CREATE INDEX "Candidate_organizationId_idx" ON "Candidate"("organizationId");

-- CreateIndex
CREATE INDEX "Candidate_hiringRequestId_stage_idx" ON "Candidate"("hiringRequestId", "stage");

-- CreateIndex
CREATE INDEX "Candidate_organizationId_stage_idx" ON "Candidate"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "Candidate_email_idx" ON "Candidate"("email");

-- CreateIndex
CREATE INDEX "Candidate_lastName_firstName_idx" ON "Candidate"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Candidate_hiringRequestId_rating_idx" ON "Candidate"("hiringRequestId", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_organizationId_email_hiringRequestId_key" ON "Candidate"("organizationId", "email", "hiringRequestId");

-- CreateIndex
CREATE INDEX "CandidateSkill_candidateId_idx" ON "CandidateSkill"("candidateId");

-- CreateIndex
CREATE INDEX "CandidateSkill_name_idx" ON "CandidateSkill"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateSkill_candidateId_name_key" ON "CandidateSkill"("candidateId", "name");

-- CreateIndex
CREATE INDEX "CandidateExperience_candidateId_idx" ON "CandidateExperience"("candidateId");

-- CreateIndex
CREATE INDEX "CandidateExperience_candidateId_isCurrent_idx" ON "CandidateExperience"("candidateId", "isCurrent");

-- CreateIndex
CREATE INDEX "CandidateExperience_company_idx" ON "CandidateExperience"("company");

-- CreateIndex
CREATE INDEX "CandidateEducation_candidateId_idx" ON "CandidateEducation"("candidateId");

-- CreateIndex
CREATE INDEX "CandidateEducation_institution_idx" ON "CandidateEducation"("institution");

-- CreateIndex
CREATE INDEX "CandidateEducation_field_idx" ON "CandidateEducation"("field");

-- CreateIndex
CREATE INDEX "CandidateCertification_candidateId_idx" ON "CandidateCertification"("candidateId");

-- CreateIndex
CREATE INDEX "CandidateCertification_name_idx" ON "CandidateCertification"("name");

-- CreateIndex
CREATE INDEX "CandidateCertification_issuer_idx" ON "CandidateCertification"("issuer");

-- CreateIndex
CREATE INDEX "CVFile_candidateId_idx" ON "CVFile"("candidateId");

-- CreateIndex
CREATE INDEX "Interview_organizationId_idx" ON "Interview"("organizationId");

-- CreateIndex
CREATE INDEX "Interview_hiringRequestId_scheduledAt_idx" ON "Interview"("hiringRequestId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_candidateId_scheduledAt_idx" ON "Interview"("candidateId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_scheduledAt_idx" ON "Interview"("scheduledAt");

-- CreateIndex
CREATE INDEX "Interview_status_scheduledAt_idx" ON "Interview"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "InterviewParticipant_interviewId_idx" ON "InterviewParticipant"("interviewId");

-- CreateIndex
CREATE INDEX "InterviewParticipant_userId_idx" ON "InterviewParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewParticipant_interviewId_userId_key" ON "InterviewParticipant"("interviewId", "userId");

-- CreateIndex
CREATE INDEX "InterviewQuestion_interviewId_order_idx" ON "InterviewQuestion"("interviewId", "order");

-- CreateIndex
CREATE INDEX "InterviewQuestion_interviewId_category_idx" ON "InterviewQuestion"("interviewId", "category");

-- CreateIndex
CREATE INDEX "InterviewEvaluation_interviewId_idx" ON "InterviewEvaluation"("interviewId");

-- CreateIndex
CREATE INDEX "InterviewEvaluation_evaluatorId_idx" ON "InterviewEvaluation"("evaluatorId");

-- CreateIndex
CREATE INDEX "InterviewEvaluation_recommendation_idx" ON "InterviewEvaluation"("recommendation");

-- CreateIndex
CREATE INDEX "Offer_organizationId_idx" ON "Offer"("organizationId");

-- CreateIndex
CREATE INDEX "Offer_hiringRequestId_idx" ON "Offer"("hiringRequestId");

-- CreateIndex
CREATE INDEX "Offer_candidateId_idx" ON "Offer"("candidateId");

-- CreateIndex
CREATE INDEX "Offer_status_idx" ON "Offer"("status");

-- CreateIndex
CREATE INDEX "Activity_organizationId_occurredAt_idx" ON "Activity"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_organizationId_type_idx" ON "Activity"("organizationId", "type");

-- CreateIndex
CREATE INDEX "Activity_candidateId_occurredAt_idx" ON "Activity"("candidateId", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_hiringRequestId_occurredAt_idx" ON "Activity"("hiringRequestId", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_actorId_occurredAt_idx" ON "Activity"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "AITask_organizationId_status_idx" ON "AITask"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AITask_organizationId_type_idx" ON "AITask"("organizationId", "type");

-- CreateIndex
CREATE INDEX "AITask_hiringRequestId_idx" ON "AITask"("hiringRequestId");

-- CreateIndex
CREATE INDEX "AITask_createdById_createdAt_idx" ON "AITask"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "AIConversation_taskId_createdAt_idx" ON "AIConversation"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "PromptTemplate_organizationId_category_idx" ON "PromptTemplate"("organizationId", "category");

-- CreateIndex
CREATE INDEX "PromptTemplate_category_isPublic_idx" ON "PromptTemplate"("category", "isPublic");

-- CreateIndex
CREATE INDEX "PromptTemplate_name_idx" ON "PromptTemplate"("name");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_headUserId_fkey" FOREIGN KEY ("headUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringRequest" ADD CONSTRAINT "HiringRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringRequest" ADD CONSTRAINT "HiringRequest_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringRequest" ADD CONSTRAINT "HiringRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringRequest" ADD CONSTRAINT "HiringRequest_hiringManagerId_fkey" FOREIGN KEY ("hiringManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringRequest" ADD CONSTRAINT "HiringRequest_jobDescriptionId_fkey" FOREIGN KEY ("jobDescriptionId") REFERENCES "JobDescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_hiringRequestId_fkey" FOREIGN KEY ("hiringRequestId") REFERENCES "HiringRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateExperience" ADD CONSTRAINT "CandidateExperience_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateEducation" ADD CONSTRAINT "CandidateEducation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateCertification" ADD CONSTRAINT "CandidateCertification_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CVFile" ADD CONSTRAINT "CVFile_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_hiringRequestId_fkey" FOREIGN KEY ("hiringRequestId") REFERENCES "HiringRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_scheduledById_fkey" FOREIGN KEY ("scheduledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewParticipant" ADD CONSTRAINT "InterviewParticipant_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewParticipant" ADD CONSTRAINT "InterviewParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewEvaluation" ADD CONSTRAINT "InterviewEvaluation_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewEvaluation" ADD CONSTRAINT "InterviewEvaluation_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_hiringRequestId_fkey" FOREIGN KEY ("hiringRequestId") REFERENCES "HiringRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_hiringRequestId_fkey" FOREIGN KEY ("hiringRequestId") REFERENCES "HiringRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITask" ADD CONSTRAINT "AITask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITask" ADD CONSTRAINT "AITask_hiringRequestId_fkey" FOREIGN KEY ("hiringRequestId") REFERENCES "HiringRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITask" ADD CONSTRAINT "AITask_jobDescriptionId_fkey" FOREIGN KEY ("jobDescriptionId") REFERENCES "JobDescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITask" ADD CONSTRAINT "AITask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIConversation" ADD CONSTRAINT "AIConversation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AITask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
