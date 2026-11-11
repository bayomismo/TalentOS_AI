/**
 * Sprint 19 — Offer expiry backstop (audit P1-04).
 *
 * BEFORE THIS, `EXPIRED` was unreachable in practice:
 *   - there was no cron and no read-time check that compared
 *     `expiresAt` with now,
 *   - `recordOfferResponse('EXPIRED')` performed no date validation, so
 *     an offer could be expired months early — or accepted long after
 *     it had expired.
 *
 * An expired offer that stays ISSUED keeps the candidate in "active
 * offer" state, blocks a replacement offer, and inflates the "issued"
 * metric forever.
 *
 * TWO BACKSTOPS, ONE IMPLEMENTATION
 *   1. `expireStaleOffers()` — called by the cron route AND by the
 *      offer read paths (lazy expiry). Idempotent: an offer that is
 *      already EXPIRED is never touched again.
 *   2. `expireOffer()` in the service — the explicit, audited manual
 *      expiry (it refuses to expire an offer whose date has not passed).
 *
 * The candidate leaves the OFFER stage when their offer expires: OFFER
 * has exactly three legal exits (HIRED, REJECTED, WITHDRAWN) and an
 * expired offer is not a live one.
 */

import { ActivityType, OfferStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'
import { transitionCandidateStage } from '@/lib/candidates/transition'
import { syncHiringRequestFilled } from '@/lib/hiring-requests/capacity'

/** The statuses an offer can still expire FROM. */
const EXPIRABLE_STATUSES: OfferStatus[] = [OfferStatus.APPROVED, OfferStatus.ISSUED]

export interface ExpireResult {
  /** Offers that were expired by this run. */
  expired: number
  /** Offers that were already expired (the backstop is idempotent). */
  alreadyExpired: number
  /** Ids of the offers that were expired. */
  expiredOfferIds: string[]
  /** Offers that could not be expired (with the reason). */
  skipped: Array<{ offerId: string; reason: string }>
}

/**
 * Expires every offer whose expiry date has passed.
 *
 * @param organizationId when given, only that organization's offers are
 *        touched (the read path). The cron runs without it and sweeps
 *        every tenant.
 */
export async function expireStaleOffers(
  organizationId?: string,
  options: { limit?: number } = {},
): Promise<ExpireResult> {
  const now = new Date()
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)

  const stale = await db.offer.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      status: { in: EXPIRABLE_STATUSES },
      expiresAt: { not: null, lt: now },
    },
    select: {
      id: true,
      organizationId: true,
      candidateId: true,
      hiringRequestId: true,
      status: true,
      expiresAt: true,
    },
    orderBy: { expiresAt: 'asc' },
    take: limit,
  })

  const result: ExpireResult = {
    expired: 0,
    alreadyExpired: 0,
    expiredOfferIds: [],
    skipped: [],
  }

  for (const offer of stale) {
    try {
      const updated = await db.$transaction(async (tx) => {
        // Re-read inside the transaction: the offer may have been
        // accepted, withdrawn or expired between the scan and the write.
        const current = await tx.offer.findFirst({
          where: { id: offer.id, organizationId: offer.organizationId },
          select: { id: true, status: true, candidateId: true, hiringRequestId: true },
        })
        if (!current) return { ok: false as const, reason: 'offer no longer exists' }
        if (current.status === OfferStatus.EXPIRED) {
          return { ok: false as const, reason: 'already expired' }
        }
        if (!EXPIRABLE_STATUSES.includes(current.status)) {
          return { ok: false as const, reason: `status ${current.status} is not expirable` }
        }

        const updated = await tx.offer.update({
          where: { id: current.id },
          data: { status: OfferStatus.EXPIRED, expiredAt: now, respondedAt: now },
        })

        // The candidate must not stay in OFFER with a dead offer.
        const staged = await tx.candidate.findFirst({
          where: { id: current.candidateId, organizationId: offer.organizationId },
          select: { id: true, stage: true },
        })
        if (staged && staged.stage === 'OFFER') {
          await transitionCandidateStage(tx, {
            candidateId: staged.id,
            toStage: 'WITHDRAWN',
            reason: 'Offer expired',
          })
        }

        // `filled` is derived — keep it in step with the pipeline.
        await syncHiringRequestFilled(tx, current.hiringRequestId)

        await tx.activity.create({
          data: {
            organizationId: offer.organizationId,
            type: ActivityType.OFFER_EXPIRED,
            actorId: null,
            offerId: updated.id,
            candidateId: updated.candidateId,
            hiringRequestId: updated.hiringRequestId,
            title: 'Offer expired',
            description: 'The offer expiry date passed and the offer was expired automatically.',
          },
        })

        return { ok: true as const, offer: updated }
      })

      if (updated.ok) {
        result.expired++
        result.expiredOfferIds.push(offer.id)
        await recordAuditLog({
          organizationId: offer.organizationId,
          actorId: null,
          action: 'OFFER_EXPIRED',
          targetType: 'offer',
          targetId: offer.id,
          outcome: 'success',
          reason: 'expiry_date_passed',
          metadata: { expiresAt: offer.expiresAt?.toISOString() ?? null },
        })
      } else if (updated.reason === 'already expired') {
        result.alreadyExpired++
      } else {
        result.skipped.push({ offerId: offer.id, reason: updated.reason })
      }
    } catch (err) {
      result.skipped.push({
        offerId: offer.id,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}
