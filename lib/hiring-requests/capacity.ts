/**
 * Sprint 19 — hiring-request capacity & the `filled` counter (audit
 * P0-02, P1-18, P1-25).
 *
 * THE SINGLE SOURCE OF TRUTH
 * --------------------------
 * `HiringRequest.filled` and "how many candidates are in stage HIRED on
 * this requisition" are the SAME FACT. Before this module the product
 * had two answers for it:
 *
 *   - `HiringRequest.filled` — written exactly once, as `0`, at
 *     requisition creation. Permanently decorative.
 *   - the Decision Hub's "selected decisions vs openings" — a
 *     DIFFERENT number for the same question, rendered as equally
 *     authoritative on another screen (audit P1-18).
 *
 * The rule adopted here:
 *
 *   `filled` == the number of candidates on the requisition whose stage
 *   is `HIRED`.
 *
 * It is DERIVED, not accumulated. A counter drifts: every new write
 * path that forgets to increment it re-creates P0-02, and a reversal
 * that forgets to decrement it over-reports the number of hires. A
 * derived value cannot drift — it is recomputed from the pipeline
 * itself.
 *
 * Consequences (all intentional):
 *
 *   - A candidate moved to HIRED by ANY path (manual drag, bulk move,
 *     accepted offer) counts immediately.
 *   - A candidate moved back out of HIRED stops counting immediately.
 *   - `filled` can never go below 0 (a count cannot be negative).
 *   - `filled` is NOT clamped to `openings`. `openings` is the budget a
 *     recruiter sets; `filled` is a fact about the pipeline. The rule
 *     "never exceed openings" is enforced as a GATE on adding
 *     candidates (see `evaluateHiringRequestCapacity`), not by
 *     rewriting history. Rewriting the fact would make the number a
 *     lie — exactly what this audit was about.
 *
 * PUBLIC API (other tracks depend on this — see the fix-candidates
 * deliverable):
 *
 *   countHiredCandidates(tx, hiringRequestId): Promise<number>
 *   countActiveApplicants(tx, hiringRequestId): Promise<number>
 *   syncHiringRequestFilled(tx, hiringRequestId): Promise<number>
 *   evaluateHiringRequestCapacity(tx, hiringRequest, opts?): Promise<CapacityResult>
 *
 * `syncHiringRequestFilled` MUST be called by every path that changes a
 * candidate's stage to or from HIRED — including the offer-acceptance
 * path in `features/offers/**`.
 */

import type { Prisma } from '@prisma/client'
import { ACTIVE_APPLICATION_STAGES } from '@/lib/candidates/status'

/** A candidate in a terminal stage does not occupy an opening. */
export const TERMINAL_APPLICATION_STAGES: readonly string[] = ['HIRED', 'REJECTED', 'WITHDRAWN']

/**
 * The number of candidates on the requisition that are HIRED. This is
 * the value `HiringRequest.filled` mirrors.
 */
export async function countHiredCandidates(
  tx: Prisma.TransactionClient,
  hiringRequestId: string,
): Promise<number> {
  return tx.candidate.count({
    where: { hiringRequestId, stage: 'HIRED' },
  })
}

/**
 * The number of candidates on the requisition that are still IN the
 * pipeline — i.e. not in a terminal stage. These are the "active
 * applicants" that compete for the requisition's openings.
 */
export async function countActiveApplicants(
  tx: Prisma.TransactionClient,
  hiringRequestId: string,
): Promise<number> {
  return tx.candidate.count({
    where: {
      hiringRequestId,
      stage: { in: [...ACTIVE_APPLICATION_STAGES] },
    },
  })
}

/**
 * Recomputes `HiringRequest.filled` from the pipeline and persists it.
 *
 * Returns the persisted value. Never returns a negative number.
 *
 * Call it after ANY stage change that can add or remove a hire — in the
 * same transaction as the stage write, so the counter and the pipeline
 * can never disagree.
 */
export async function syncHiringRequestFilled(
  tx: Prisma.TransactionClient,
  hiringRequestId: string,
): Promise<number> {
  const hired = await countHiredCandidates(tx, hiringRequestId)
  const filled = Math.max(0, hired)

  await tx.hiringRequest.update({
    where: { id: hiringRequestId },
    data: { filled },
  })

  return filled
}

export interface CapacityInput {
  id: string
  title: string
  openings: number
  filled: number
}

export interface CapacityResult {
  ok: boolean
  /** Hires recorded on the requisition. */
  filled: number
  /** Candidates still in the pipeline (not in a terminal stage). */
  activeApplicants: number
  /** The requisition's opening budget. */
  openings: number
  /** How many more candidates may be added. Never negative. */
  remaining: number
  /** Human-readable reason, set when `ok` is false. */
  message?: string
}

/**
 * The capacity gate for ADDING a candidate (audit P1-25).
 *
 * A requisition with 1 opening does not accept 40 candidates. The
 * business rule implemented here:
 *
 *   `filled + activeApplicants >= openings`  →  the requisition is FULL
 *   and a new candidate must be refused.
 *
 * "Active" means "still in the pipeline": APPLIED, SCREENING, INTERVIEW
 * or OFFER. A candidate who was rejected or withdrew frees their slot
 * again; a hired candidate counts through `filled`.
 *
 * `additional` is how many candidates the caller is about to add (1 for
 * a manual add or a CV upload, N for a CSV import). The gate refuses
 * the whole batch when it does not fit, and says exactly how many rows
 * do not fit.
 */
export async function evaluateHiringRequestCapacity(
  tx: Prisma.TransactionClient,
  hiringRequest: CapacityInput,
  options: { additional?: number } = {},
): Promise<CapacityResult> {
  const additional = Math.max(0, options.additional ?? 1)
  const openings = Math.max(0, hiringRequest.openings)
  const filled = Math.max(0, hiringRequest.filled)
  const activeApplicants = await countActiveApplicants(tx, hiringRequest.id)
  const remaining = Math.max(0, openings - filled - activeApplicants)

  if (remaining === 0) {
    return {
      ok: false,
      filled,
      activeApplicants,
      openings,
      remaining,
      message:
        `"${hiringRequest.title}" has no capacity left: ${openings} opening${openings === 1 ? '' : 's'}, ` +
        `${filled} filled and ${activeApplicants} active candidate${activeApplicants === 1 ? '' : 's'}. ` +
        'Raise the number of openings, close some candidates, or use a different requisition.',
    }
  }

  if (additional > remaining) {
    return {
      ok: false,
      filled,
      activeApplicants,
      openings,
      remaining,
      message:
        `"${hiringRequest.title}" can only take ${remaining} more candidate${remaining === 1 ? '' : 's'} ` +
        `(${openings} opening${openings === 1 ? '' : 's'}, ${filled} filled, ${activeApplicants} active). ` +
        `${additional} were requested — ${additional - remaining} too many.`,
    }
  }

  return { ok: true, filled, activeApplicants, openings, remaining }
}
