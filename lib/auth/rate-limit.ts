/**
 * Sprint 13 → Sprint 19 — Rate limiter for sensitive endpoints.
 *
 * Backed by the `RateLimitHit` table (Postgres) so the limit holds
 * across Vercel's many short-lived Lambda instances. The previous
 * implementation used a module-level `Map`, which reset on every cold
 * start and was not shared between instances — so the limit was close
 * to unenforced in production.
 *
 * Semantics: fixed window. A key gets `limit` hits per `windowSeconds`.
 * The window boundary is aligned to the epoch (`floor(now / window)`),
 * so every instance independently agrees on which window a request
 * falls in without any coordination.
 *
 * Atomicity: each call is a single
 *   `INSERT ... ON CONFLICT ("bucketKey", "windowStart")
 *    DO UPDATE SET "count" = "count" + 1 RETURNING "count"`
 * and the post-increment count is read back, so two concurrent callers
 * cannot both pass the check at `count = limit - 1`.
 *
 * Fail-open: if the DB write throws, the call is allowed and the error
 * is logged. A rate-limiter outage must not take down login, signup, or
 * job applications. (This matches the old behaviour — a fresh Map also
 * meant "no limit".)
 *
 * Cleanup: expired rows are swept opportunistically on a small fraction
 * of calls, so no cron job is required.
 */

import { db } from '@/lib/db'

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetInSeconds: number
}

/** Probability that a given call also sweeps fully-expired rows. */
const CLEANUP_PROBABILITY = 0.02

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Date.now()
  const windowMs = windowSeconds * 1000
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs)
  const expiresAt = new Date(windowStart.getTime() + windowMs)
  const resetInSeconds = Math.max(0, Math.ceil((expiresAt.getTime() - now) / 1000))

  try {
    const rows = await db.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "RateLimitHit" ("bucketKey", "windowStart", "count", "expiresAt")
      VALUES (${key}, ${windowStart}, 1, ${expiresAt})
      ON CONFLICT ("bucketKey", "windowStart")
      DO UPDATE SET "count" = "RateLimitHit"."count" + 1
      RETURNING "count"
    `
    const count = Number(rows[0]?.count ?? 1)

    if (Math.random() < CLEANUP_PROBABILITY) {
      void db
        .$executeRaw`DELETE FROM "RateLimitHit" WHERE "expiresAt" < ${new Date(now)}`
        .catch(() => undefined)
    }

    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      resetInSeconds,
    }
  } catch (err) {
    console.error(
      '[rate-limit] DB error, failing open:',
      err instanceof Error ? err.message : err,
    )
    return { ok: true, remaining: limit, resetInSeconds }
  }
}
