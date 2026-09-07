-- Sprint 11.1 — Copilot Confirmed AI Actions
--
-- Adds:
--   * CopilotActionConfirmation: server-controlled record that gates
--     every AI-proposed mutation. The browser never sends the final
--     authoritative mutation payload — the server reconstructs it
--     from the confirmation row at CONFIRM time.
--
-- Hard rules:
--   * Single-use: status PENDING -> EXECUTED / EXPIRED / CANCELLED
--   * User-bound: userId must match at confirm
--   * Org-bound: organizationId must match at confirm
--   * Action-bound: actionId must match at confirm
--   * Time-limited: expiresAt default 10 minutes
--
-- This is an additive migration. No existing tables are modified.

-- CreateEnum: CopilotActionStatus
CREATE TYPE "CopilotActionStatus" AS ENUM (
  'PENDING',
  'EXECUTED',
  'EXPIRED',
  'CANCELLED',
  'FAILED'
);

-- CreateEnum: CopilotActionType (the 3 allowed actions in Sprint 11.1)
CREATE TYPE "CopilotActionType" AS ENUM (
  'CREATE_HIRING_REQUEST_DRAFT',
  'SCHEDULE_INTERVIEW',
  'CREATE_OFFER_DRAFT'
);

-- CreateTable
CREATE TABLE "CopilotActionConfirmation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "actionId" TEXT NOT NULL,
  "actionType" "CopilotActionType" NOT NULL,
  "payload" JSONB NOT NULL,
  "preview" JSONB NOT NULL,
  "status" "CopilotActionStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "executedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "resultResourceId" UUID,
  "resultResourceType" TEXT,
  "conversationId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CopilotActionConfirmation_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "CopilotActionConfirmation"
  ADD CONSTRAINT "CopilotActionConfirmation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CopilotActionConfirmation"
  ADD CONSTRAINT "CopilotActionConfirmation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes for the security-critical lookup patterns
-- Confirm must filter by id+organizationId+userId+status+expiresAt
CREATE INDEX "CopilotActionConfirmation_org_status_idx" ON "CopilotActionConfirmation"("organizationId", "status");
CREATE INDEX "CopilotActionConfirmation_user_idx" ON "CopilotActionConfirmation"("userId", "createdAt" DESC);
CREATE INDEX "CopilotActionConfirmation_expiresAt_idx" ON "CopilotActionConfirmation"("expiresAt");
