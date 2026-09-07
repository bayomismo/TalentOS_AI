/**
 * Sprint 13 — Simple in-memory rate limiter for sensitive endpoints.
 *
 * NOTE: This is a best-effort rate limiter suitable for low-volume
 * serverless environments. It uses a sliding window and resets on a
 * fixed cadence. For production-grade rate limiting at high scale,
 * swap this for a Redis-backed limiter — the interface here is
 * stable.
 *
 * The signup route uses this to throttle repeated signups from the
 * same IP / same email.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetInSeconds: number
}

export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + windowSeconds * 1000 }
    buckets.set(key, b)
  }
  b.count += 1
  const remaining = Math.max(0, limit - b.count)
  const resetInSeconds = Math.max(0, Math.ceil((b.resetAt - now) / 1000))
  return { ok: b.count <= limit, remaining, resetInSeconds }
}

// Light periodic cleanup to prevent unbounded memory growth in long-lived
// processes. (In serverless this is a no-op since the process exits
// between requests.)
if (typeof setInterval !== 'undefined') {
  const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
  setInterval(() => {
    const now = Date.now()
    for (const [k, b] of buckets.entries()) {
      if (b.resetAt < now) buckets.delete(k)
    }
  }, CLEANUP_INTERVAL_MS).unref?.()
}
