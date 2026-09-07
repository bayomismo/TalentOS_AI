-- Sprint 12 — User Management additions to Invitation
--
-- Adds firstName / lastName / departmentId to the Invitation model so
-- the invite form can capture the recipient's name up-front (instead of
-- only at acceptance time) and bind the new account to a department.

ALTER TABLE "Invitation"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName"  TEXT,
  ADD COLUMN "departmentId" UUID;

ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Invitation_org_status_idx" ON "Invitation"("organizationId", "status");
