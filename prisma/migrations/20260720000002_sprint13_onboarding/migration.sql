-- Sprint 13 — SaaS Onboarding & Real Profile
--
-- Adds:
--   - User.onboardingStatus  (PENDING | COMPLETED) — first-ADMIN onboarding gate
--   - User.onboardingStep    (ACCOUNT_CREATED | ORG_PENDING | ORG_CREATED | COMPANY_CONFIGURED | TEAM_INVITED | COMPLETED)
--   - Organization.country
--   - Organization.timezone
--   - Organization.onboardingCompletedAt
--
-- Backward compatibility: every existing Organization and User is backfilled
-- as COMPLETED so the current production owner is NOT forced through
-- onboarding again.

-- 1. Create the OnboardingStatus enum
DO $$ BEGIN
  CREATE TYPE "OnboardingStatus" AS ENUM ('PENDING', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Create the OnboardingStep enum
DO $$ BEGIN
  CREATE TYPE "OnboardingStep" AS ENUM ('ACCOUNT_CREATED', 'ORG_PENDING', 'ORG_CREATED', 'COMPANY_CONFIGURED', 'TEAM_INVITED', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Add columns to User (default COMPLETED = backward-compat)
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN IF NOT EXISTS "onboardingStep"   "OnboardingStep"   NOT NULL DEFAULT 'COMPLETED';

-- 4. Add columns to Organization
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "country"         TEXT,
  ADD COLUMN IF NOT EXISTS "timezone"        TEXT,
  ADD COLUMN IF NOT EXISTS "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);

-- 5. Backfill existing organizations as COMPLETED
UPDATE "Organization"
  SET "onboardingCompletedAt" = "createdAt"
  WHERE "onboardingCompletedAt" IS NULL;
