-- Sprint 16 — Email outbox + password reset tokens
--
-- Adds:
--   - EmailOutbox            — every outgoing email is written here first.
--                              The default LocalOutboxProvider always succeeds;
--                              a future cron job (Sprint 18) will sweep
--                              PENDING rows and deliver them via a real
--                              provider (Resend, SES, Postmark).
--   - PasswordResetToken     — same pattern as Invitation tokens: 32-byte
--                              random secret, persisted as SHA-256 hash +
--                              8-char plaintext prefix for the UI. TTL 1
--                              hour, single use.

CREATE TABLE "EmailOutbox" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"      TEXT NOT NULL,
  "to"        TEXT NOT NULL,
  "fromAddr"  TEXT,
  "subject"   TEXT NOT NULL,
  "text"      TEXT NOT NULL,
  "html"      TEXT,
  "metadata"  JSONB,
  "status"    TEXT NOT NULL DEFAULT 'PENDING',
  "sentAt"    TIMESTAMP(3),
  "failure"   TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "EmailOutbox_status_createdAt_idx" ON "EmailOutbox"("status", "createdAt");
CREATE INDEX "EmailOutbox_kind_createdAt_idx"   ON "EmailOutbox"("kind",   "createdAt");
CREATE INDEX "EmailOutbox_to_idx"               ON "EmailOutbox"("to");

CREATE TABLE "PasswordResetToken" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"           UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "tokenHash"        TEXT NOT NULL UNIQUE,
  "tokenPrefix"      TEXT NOT NULL,
  "expiresAt"        TIMESTAMP(3) NOT NULL,
  "usedAt"           TIMESTAMP(3),
  "requestIp"        TEXT,
  "requestUserAgent" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt" DESC);
CREATE INDEX "PasswordResetToken_expiresAt_idx"        ON "PasswordResetToken"("expiresAt");
