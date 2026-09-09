/**
 * Sprint 16 → Sprint 19 — AI rate limit + per-org monthly quota.
 *
 * Reservation lifecycle (Sprint 19):
 *
 *   enforceAiQuota()   atomic, in a transaction. Locks the Organization
 *                      row (SELECT ... FOR UPDATE), counts the cycle's
 *                      successful rows, and — if under the cap — INSERTs
 *                      a RESERVATION row: { success: true, tokensIn: NULL }.
 *                      Returns `usageId`. Two concurrent callers cannot
 *                      both pass at used = quota - 1: the row lock
 *                      serialises them.
 *
 *   recordAiUsage({ usageId })   FINALIZE. Updates that same row's
 *                                tokensIn/tokensOut (0 when the provider
 *                                did not report them). The row stays
 *                                counted. Never inserts a second row.
 *
 *   releaseAiQuota(usageId)      RELEASE. On any AI failure, flips the
 *                                reservation to success:false so it no
 *                                longer counts. Matched by `usageId` AND
 *                                `tokensIn IS NULL` — never touches a
 *                                finalized row or a historical row.
 *
 *   runWithAiReservation(...)    Wrapper that finalizes on success and
 *                                releases on throw. Use it for every
 *                                engine call so the release cannot be
 *                                missed in a nested loop or a rethrow.
 *
 * Fail-open (documented, NOT absolute enforcement):
 *   - Healthy DB  → atomic enforcement; concurrent callers cannot exceed
 *                   the cap.
 *   - Transaction failure / DB outage / lock timeout → the request
 *                   PROCEEDS UNCOUNTED. A single-line error is logged:
 *                   `[quota] ENFORCE_FAILED_OPEN org=<id> feature=<f> ...`
 *                   This matches the pre-Sprint-19 behaviour (every quota
 *                   write was already best-effort). Do not describe quota
 *                   as guaranteed.
 *
 * Not counted: health checks; calls denied before reservation; released
 * (failed) reservations. There is NO stale-reservation sweep in this
 * phase — a process crash between reserve and finalize/release leaves one
 * orphan reservation counting until the cycle resets (tracked separately).
 *
 * Design:
 *   - Per-org, per-calendar-month cap (resets on the 1st, UTC).
 *   - Default quota 5,000 calls/month; -1 = unlimited.
 *   - Soft warning at 80% — the /settings meter.
 *   - Tenant isolation: the org id is always an argument, never derived
 *     from the request; the row lock + count are per-org.
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
  /**
   * ID of the reservation row created by `enforceAiQuota`. Present only
   * when `allowed` is true and the reservation was actually written.
   * Undefined for `checkAiQuota` (pre-flight only) and for the fail-open
   * path (allowed but uncounted). Pass it to `recordAiUsage` to finalize
   * or `releaseAiQuota` to release.
   */
  usageId?: string
}

/**
 * PRE-FLIGHT / UI ONLY. Reads the org's quota config and current cycle
 * usage. Does NOT reserve, insert, or consume anything, and never
 * returns a `usageId`.
 *
 * Use this for "is the org already over the limit before I start a batch"
 * guards and for the /settings meter. It is NOT an authorisation to spend:
 * every actual engine call must still go through `enforceAiQuota`, which
 * re-checks atomically under the org row lock.
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
 * AUTHORITATIVE. Atomically reserve one unit of quota for an AI engine
 * call. Run this IMMEDIATELY before the engine call, then either
 * `recordAiUsage({ usageId })` on success or `releaseAiQuota(usageId)` on
 * failure (or wrap the call in `runWithAiReservation`, which does both).
 *
 * Transaction: `SELECT "aiMonthlyQuota" FROM "Organization" ... FOR UPDATE`
 * serialises every concurrent enforce for the same org on the org row, so
 * the count-then-insert cannot race. Different orgs lock different rows.
 *
 * Fail-open: on transaction error the call is ALLOWED but uncounted, with
 * a greppable log line. See the file header — this is not absolute
 * enforcement.
 */
export async function enforceAiQuota(
  organizationId: string,
  feature: AIFeature,
  taskId?: string,
): Promise<QuotaCheckResult> {
  const now = new Date()
  const cycleStart = startOfMonth(now)
  const resetAt = startOfNextMonth(now)

  let outcome:
    | { kind: 'ok'; usageId: string; quota: number; used: number }
    | { kind: 'limit_reached'; quota: number; used: number }
    | { kind: 'org_not_found' }

  try {
    outcome = await db.$transaction(async (tx) => {
      // Row lock: concurrent enforce() for THIS org serialise here.
      const orgRows = await tx.$queryRaw<Array<{ aiMonthlyQuota: number }>>`
        SELECT "aiMonthlyQuota" FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE
      `
      if (orgRows.length === 0) return { kind: 'org_not_found' as const }
      const quota = Number(orgRows[0].aiMonthlyQuota)

      let used = 0
      if (quota !== -1) {
        used = await tx.aIUsage.count({
          where: { organizationId, success: true, createdAt: { gte: cycleStart } },
        })
        if (used >= quota) return { kind: 'limit_reached' as const, quota, used }
      }

      const row = await tx.aIUsage.create({
        data: { organizationId, feature, taskId, success: true }, // tokensIn NULL = reservation
        select: { id: true },
      })
      return { kind: 'ok' as const, usageId: row.id, quota, used: used + 1 }
    }, { timeout: 8000 })
  } catch (err) {
    // FAIL-OPEN. Proceed uncounted; log for metrics/alerting.
    console.error(
      `[quota] ENFORCE_FAILED_OPEN org=${organizationId} feature=${feature} — request allowed without reservation: ` +
        (err instanceof Error ? err.message : String(err)),
    )
    const pre = await checkAiQuota(organizationId).catch(() => null)
    return {
      allowed: true,
      quota: pre?.quota ?? 0,
      used: pre?.used ?? 0,
      percent: pre?.percent,
      resetAt: pre?.resetAt ?? resetAt,
      warning: pre?.warning ?? null,
      usageId: undefined,
    }
  }

  if (outcome.kind === 'org_not_found') {
    return {
      allowed: false, quota: 0, used: 0, percent: undefined, resetAt,
      warning: null, reason: 'ORG_NOT_FOUND', message: 'Organization not found.',
    }
  }

  if (outcome.kind === 'limit_reached') {
    // Log the denied attempt (best-effort) so admins can see abuse patterns.
    await db.aIUsage.create({ data: { organizationId, feature, taskId, success: false } }).catch(() => null)
    return {
      allowed: false, quota: outcome.quota, used: outcome.used,
      percent: outcome.quota > 0 ? 1 : 0, resetAt, warning: 'APPROACHING_LIMIT',
      reason: 'LIMIT_REACHED',
      message: `AI limit reached (${outcome.used.toLocaleString()} of ${outcome.quota.toLocaleString()} calls this month). The limit resets on ${formatResetDate(resetAt)}.`,
    }
  }

  const percent =
    outcome.quota === -1 ? undefined : outcome.quota > 0 ? outcome.used / outcome.quota : 0
  return {
    allowed: true,
    quota: outcome.quota,
    used: outcome.used,
    percent,
    resetAt,
    warning: percent !== undefined && percent >= 0.8 ? 'APPROACHING_LIMIT' : null,
    usageId: outcome.usageId,
  }
}

/**
 * FINALIZE a reservation. Call after the engine returns successfully.
 *
 * With a `usageId` (the normal path) this UPDATEs the reservation row in
 * place — it never inserts a second row, and it only ever touches the one
 * row `enforceAiQuota` created. `tokensIn`/`tokensOut` default to 0 (not
 * NULL) so a NULL `tokensIn` unambiguously marks an un-finalized
 * reservation.
 *
 * Without a `usageId` (legacy callers that did not reserve) it inserts a
 * `success: true` row directly, as before.
 */
export async function recordAiUsage(args: {
  usageId?: string
  organizationId?: string
  feature?: AIFeature
  taskId?: string
  tokensIn?: number
  tokensOut?: number
}): Promise<void> {
  const tokensIn = args.tokensIn ?? 0
  const tokensOut = args.tokensOut ?? 0

  if (args.usageId) {
    // `success: true` in the filter means a released reservation
    // (success:false) or any non-reservation row is never touched, on top
    // of the `id` match already scoping this to the one reservation row.
    await db.aIUsage
      .updateMany({ where: { id: args.usageId, success: true }, data: { tokensIn, tokensOut } })
      .catch(() => null)
    return
  }

  if (!args.organizationId || !args.feature) return
  await db.aIUsage
    .create({
      data: {
        organizationId: args.organizationId,
        feature: args.feature,
        taskId: args.taskId,
        tokensIn,
        tokensOut,
        success: true,
      },
    })
    .catch(() => null)
}

/**
 * RELEASE a reservation whose AI call failed, so it no longer counts
 * toward the quota. Idempotent and safe: matched by `usageId` AND
 * `tokensIn IS NULL`, so a finalized row or a historical row is never
 * touched, and a double-release is a no-op.
 */
export async function releaseAiQuota(usageId: string | undefined): Promise<void> {
  if (!usageId) return
  await db.aIUsage
    .updateMany({ where: { id: usageId, tokensIn: null }, data: { success: false } })
    .catch(() => null)
}

/**
 * Wrap an AI engine call so its reservation is ALWAYS finalized (on
 * success) or released (on any throw). Use this for every engine call
 * that follows an `enforceAiQuota` reservation — it removes the risk of a
 * missed release in a nested loop or a rethrow, because the release
 * happens before the error leaves this function.
 *
 * The caller still checks `reservation.allowed` and returns its own
 * limit-reached response BEFORE calling this.
 */
export async function runWithAiReservation<T>(
  reservation: Pick<QuotaCheckResult, 'usageId'>,
  call: () => Promise<T>,
  extractUsage: (result: T) => { tokensIn?: number; tokensOut?: number } = () => ({}),
): Promise<T> {
  try {
    const result = await call()
    await recordAiUsage({ usageId: reservation.usageId, ...extractUsage(result) })
    return result
  } catch (err) {
    await releaseAiQuota(reservation.usageId)
    throw err
  }
}

/**
 * Log a failed AI call that never held a reservation (e.g. a failure
 * detected before `enforceAiQuota`). Inserts a `success: false` row.
 * Does NOT count toward the quota. For a failed call that DID hold a
 * reservation, use `releaseAiQuota(usageId)` instead.
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
