-- Sprint 19 — Distributed fixed-window rate limiter.
--
-- Replaces the in-memory Map in lib/auth/rate-limit.ts, which did not
-- hold across Vercel's many short-lived Lambda instances. Each
-- rate-limited action (login reset, signup, public apply, job-template
-- create, job-import) now performs one atomic upsert into this table:
--
--   INSERT ... ON CONFLICT ("bucketKey", "windowStart")
--   DO UPDATE SET "count" = "count" + 1 RETURNING "count"
--
-- so concurrent callers on different instances cannot both slip under
-- the limit.
--
-- DDL below is exactly what `prisma migrate dev` generates for the
-- `RateLimitHit` model (verified with `prisma migrate diff`).

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bucketKey" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateLimitHit_expiresAt_idx" ON "RateLimitHit"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitHit_bucketKey_windowStart_key" ON "RateLimitHit"("bucketKey", "windowStart");
