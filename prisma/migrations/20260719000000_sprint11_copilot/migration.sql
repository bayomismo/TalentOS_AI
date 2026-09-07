-- Sprint 11 — TalentOS AI Copilot (Read-Only Intelligence Layer)
-- Safe additive migration. No destructive operations. Existing data preserved.

-- 1. Add COPILOT_QUERY to AITaskType
ALTER TYPE "AITaskType" ADD VALUE IF NOT EXISTS 'COPILOT_QUERY';

-- 2. Add COPILOT_QUERY_EXECUTED to AuditAction union (string column, no schema change)
-- 3. No new tables needed — AITask + AIConversation models are reused.
