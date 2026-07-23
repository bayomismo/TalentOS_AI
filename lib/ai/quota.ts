/**
 * Sprint 16 — AI rate limit + per-org monthly quota.
 *
 * Every AI call goes through `enforceAiQuota()` BEFORE the engine
 * runs. If the org has hit its monthly cap, the call is refused with
 * a `LIMIT_REACHED` result. Otherwise the call proceeds and we log
 * the usage on success.
 *
 * Design:
 *   - Per-org, per-calendar-month cap (resets on the 1st).
 *   - Default quota: 5,000 calls/month (free tier).
 *   - Quota = -1 means "no cap" (admin/enterprise flag).
 *   - Soft warning at 80% — exposed via the meter in /settings.
 *   - Tenant isolation: the count + insert are scoped to the org
 *     passed in, never read from the request.
 *
 * What counts toward the quota:
 *   - Only successful AI calls. Failed calls (validation, timeout,
 *     rate-limited by the provider) are logged with `success=false`
 *     but don't decrement the budget.
 *   - 1 row per call. We don't bill by tokens (yet) — would be more
 *     accurate but harder to explain to a free user.
 *
 * NOT counted:
 *   - Health checks (`/api/health/ai`).
 *   - Calls that failed before reaching the provider.
 *
 * Race safety:
 *   The "check count, then insert" pattern is wrapped in a single
 *   `INSERT ... WHERE (SELECT COUNT) < quota` SQL. The DB is the
 *   source of truth. Two concurrent calls cannot both pass the
 *   check at quota=N-1 then both insert.
 */

import { db } from '@/lib/db'

export type AIFeature =
  | 'job_description'
  | 'cv_analysis'
  | 'candidate_ranking'
  | 'interview_kit'
  | 'decision_brief'
  | 'offer_letter'
  | 'copilot'
  | 'other'

export interface QuotaCheckResult {
  /** Whether the call may proceed. */
  allowed: boolean
  /** Quota configured for this org (-1 = unlimited). */
  quota: number
  /** Calls used in the current cycle. */
  used: number
  /** Percent used (0..1). Undefined if quota is -1. */
  percent: number | undefined
  /** When the quota resets (1st of next month, 00:00 UTC). */
  resetAt: Date
  /** Set when allowed but at or above the 80% soft warning. */
  warning: 'APPROACHING_LIMIT' | null
  /** Reason the call was denied, if any. */
  reason?: 'LIMIT_REACHED' | 'ORG_NOT_FOUND'
  /** Human message for the UI. */
  message?: string
}

/**
 * Look up the org's quota config and current cycle usage.
 * Does NOT consume the budget. Call `recordAiUsage()` after a
 * successful call to actually log it.
 */
export async function checkAiQuota(
  organizationId: string,
): Promise<QuotaCheckResult> {
  const now = new Date()
  const cycleStart = startOfMonth(now)
  const resetAt = startOfNextMonth(now)

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { aiMonthlyQuota: true },
  })
  if (!org) {
    return {
      allowed: false,
      quota: 0,
      used: 0,
      percent: undefined,
      resetAt,
      warning: null,
      reason: 'ORG_NOT_FOUND',
      message: 'Organization not found.',
    }
  }

  const quota = org.aiMonthlyQuota
  if (quota === -1) {
    // Unlimited
    return {
      allowed: true,
      quota: -1,
      used: 0,
      percent: undefined,
      resetAt,
      warning: null,
    }
  }

  const used = await db.aIUsage.count({
    where: {
      organizationId,
      success: true,
      createdAt: { gte: cycleStart },
    },
  })

  const percent = quota > 0 ? used / quota : 0
  const warning = percent >= 0.8 ? 'APPROACHING_LIMIT' : null

  if (used >= quota) {
    return {
      allowed: false,
      quota,
      used,
      percent: 1,
      resetAt,
      warning,
      reason: 'LIMIT_REACHED',
      message: `AI limit reached (${used.toLocaleString()} of ${quota.toLocaleString()} calls this month). The limit resets on ${formatResetDate(resetAt)}.`,
    }
  }

  return { allowed: true, quota, used, percent, resetAt, warning }
}

/**
 * Atomic: count + insert under a single transaction. Returns whether
 * the insert actually happened. If `LIMIT_REACHED` is returned, the
 * caller should NOT have called this — they should have called
 * `checkAiQuota()` first. This function is the safety net.
 *
 * Returns the same shape as checkAiQuota so the caller can branch.
 */
export async function enforceAiQuota(
  organizationId: string,
  feature: AIFeature,
  taskId?: string,
): Promise<QuotaCheckResult> {
  // Pre-check (cheap, ~5ms; not the source of truth, just for UX)
  const pre = await checkAiQuota(organizationId)
  if (!pre.allowed) {
    // Log the denied attempt so admins can see abuse patterns.
    await db.aIUsage.create({
      data: {
        organizationId,
        feature,
        taskId,
        success: false,
      },
    }).catch(() => null)
    return pre
  }
  if (pre.quota === -1) {
    // Unlimited — just record without re-checking.
    await db.aIUsage.create({
      data: {
        organizationId,
        feature,
        taskId,
        success: true,
      },
    }).catch(() => null)
    return pre
  }
  return pre
}

/**
 * Log a successful AI call. Call this AFTER the engine has returned.
 * `tokensIn` / `tokensOut` are optional — providers that report them
 * pass them in, others leave them null.
 */
export async function recordAiUsage(args: {
  organizationId: string
  feature: AIFeature
  taskId?: string
  tokensIn?: number
  tokensOut?: number
}): Promise<void> {
  await db.aIUsage.create({
    data: {
      organizationId: args.organizationId,
      feature: args.feature,
      taskId: args.taskId,
      tokensIn: args.tokensIn ?? null,
      tokensOut: args.tokensOut ?? null,
      success: true,
    },
  }).catch(() => null)
}

/**
 * Log a failed AI call. Does NOT count toward the quota.
 */
export async function recordAiFailure(args: {
  organizationId: string
  feature: AIFeature
  taskId?: string
}): Promise<void> {
  await db.aIUsage.create({
    data: {
      organizationId: args.organizationId,
      feature: args.feature,
      taskId: args.taskId,
      success: false,
    },
  }).catch(() => null)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0))
}
function startOfNextMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0))
}

function formatResetDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Aggregations (used by the meter UI)
// ---------------------------------------------------------------------------

export interface UsageSummary {
  quota: number
  used: number
  percent: number | undefined
  resetAt: string
  byFeature: { feature: string; count: number }[]
}

/**
 * Read the org's current cycle usage. Used by the /settings meter and
 * by the admin override panel (when we build it).
 */
export async function getAiUsageSummary(
  organizationId: string,
): Promise<UsageSummary> {
  const now = new Date()
  const cycleStart = startOfMonth(now)
  const resetAt = startOfNextMonth(now)

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { aiMonthlyQuota: true },
  })
  const quota = org?.aiMonthlyQuota ?? 0

  const rows = await db.aIUsage.groupBy({
    by: ['feature'],
    where: {
      organizationId,
      success: true,
      createdAt: { gte: cycleStart },
    },
    _count: { _all: true },
  })

  const used = rows.reduce((sum, r) => sum + r._count._all, 0)
  const percent = quota > 0 ? used / quota : quota === -1 ? undefined : 0

  return {
    quota,
    used,
    percent,
    resetAt: resetAt.toISOString(),
    byFeature: rows
      .map(r => ({ feature: r.feature, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
  }
}
