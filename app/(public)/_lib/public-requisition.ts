/**
 * Sprint 19 — Deterministic public-posting → requisition resolution
 * (audit P1-11, P2-31, P2-09).
 *
 * A public posting is bound to exactly ONE requisition through
 * `JobDescription.publicHiringRequestId`. Before this, the apply action
 * resolved the requisition at request time with an unordered `take: 1`
 * over `DRAFT | OPEN | ON_HOLD` requisitions — so:
 *
 *   - two requisitions for the same role split applicants at random,
 *   - a DRAFT (unapproved, unpublished) requisition accepted live
 *     applications,
 *   - a CLOSED or FILLED requisition still advertised the role.
 *
 * This module is the single resolver used by the public job page, the
 * public apply form and the apply action, so all three agree.
 *
 * RESOLUTION ORDER
 *   1. `JobDescription.publicHiringRequestId` — the bound requisition.
 *      This is the only source of truth for a posting that has been
 *      bound. It wins even when it is closed: the page then shows the
 *      role as closed instead of silently falling back to another
 *      requisition.
 *   2. Fallback for postings created BEFORE the binding existed: the
 *      requisitions that point at this job description, ranked
 *      deterministically (see PREFERENCE below) and then ordered by
 *      (createdAt asc, id asc) so the same requisition is always chosen.
 *
 * STATES
 *   OPEN      — accepting applications.
 *   FILLED    — accepting applications. See THE FILLED CARVE-OUT below.
 *   ON_HOLD   — the role exists but is paused. Applicants are told the
 *               role is paused instead of being silently accepted.
 *   CLOSED    — closed, cancelled or out of capacity. Not accepting.
 *   DRAFT     — not published. Not accepting.
 *   MISSING   — no requisition behind the posting at all.
 *
 * THE FILLED CARVE-OUT
 *
 *   `HiringRequest.filled` is DERIVED: it is the number of candidates
 *   ever hired on the requisition (`lib/hiring-requests/capacity.ts`).
 *   The FILLED status is set mechanically when that derived count
 *   reaches the opening budget — it is not a decision the employer
 *   made about this posting. A requisition that hired more people than
 *   its budget (a candidate hired on a role that was already filled, a
 *   budget that was reduced afterwards) therefore reports FILLED while
 *   the team may still be hiring.
 *
 *   So the refusal is driven by the two signals that really mean "this
 *   role is not hiring":
 *     · the requisition status is DRAFT (never published), ON_HOLD
 *       (paused), CLOSED or CANCELLED (the employer closed it), or
 *     · the requisition is still OPEN and every opening has been filled
 *       (`filled >= openings`) — the live proof from the audit, where a
 *       filled requisition still accepted applications.
 *
 *   A requisition whose status is FILLED is therefore NOT refused by
 *   the capacity rule. The employer's own switches for closing a role
 *   remain the requisition status (CLOSED / CANCELLED) and the
 *   posting's `publicEnabled` flag — both of which are explicit.
 */

import { db } from '@/lib/db'

export type PublicRequisitionState =
  | 'OPEN'
  | 'FILLED'
  | 'ON_HOLD'
  | 'CLOSED'
  | 'DRAFT'
  | 'MISSING'

export interface PublicRequisition {
  id: string
  title: string
  status: string
  openings: number
  filled: number
  location: string | null
  hiringManagerId: string | null
  createdById: string
}

export interface PublicRequisitionResolution {
  state: PublicRequisitionState
  hiringRequest: PublicRequisition | null
  /** True when the posting is explicitly bound to a requisition. */
  bound: boolean
}

const REQUISITION_SELECT = {
  id: true,
  title: true,
  status: true,
  openings: true,
  filled: true,
  location: true,
  hiringManagerId: true,
  createdById: true,
} as const

/** Maps a requisition row to the state the public surfaces render. */
function stateFor(row: {
  status: string
  filled: number
  openings: number
}): PublicRequisitionState {
  if (row.status === 'OPEN') {
    // An OPEN requisition whose every opening has been filled is not
    // accepting applications — this is the case the audit proved live.
    if (row.openings > 0 && row.filled >= row.openings) return 'CLOSED'
    return 'OPEN'
  }
  if (row.status === 'ON_HOLD') return 'ON_HOLD'
  if (row.status === 'DRAFT') return 'DRAFT'
  // FILLED — see THE FILLED CARVE-OUT at the top of this file.
  if (row.status === 'FILLED') return 'FILLED'
  // CLOSED, CANCELLED
  return 'CLOSED'
}

/** The states in which a public posting still accepts applications. */
export function isAcceptingPublicState(state: PublicRequisitionState): boolean {
  return state === 'OPEN' || state === 'FILLED'
}

/**
 * Resolves the requisition a public posting belongs to.
 *
 * @param job the job description the posting is attached to. Must carry
 *   `id`, `organizationId` and `publicHiringRequestId`.
 */
export async function resolvePublicRequisition(job: {
  id: string
  organizationId: string
  publicHiringRequestId: string | null
}): Promise<PublicRequisitionResolution> {
  // 1. The bound requisition wins.
  if (job.publicHiringRequestId) {
    const bound = await db.hiringRequest.findFirst({
      where: { id: job.publicHiringRequestId, organizationId: job.organizationId },
      select: REQUISITION_SELECT,
    })
    if (!bound) {
      return { state: 'MISSING', hiringRequest: null, bound: true }
    }
    return { state: stateFor(bound), hiringRequest: bound, bound: true }
  }

  // 2. Legacy postings with no binding. Every requisition of this job
  //    description is a candidate; the ranking below is a TOTAL order,
  //    so the same requisition is chosen on every request.
  const candidates = await db.hiringRequest.findMany({
    where: {
      organizationId: job.organizationId,
      jobDescriptionId: job.id,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: REQUISITION_SELECT,
  })

  // PREFERENCE: a requisition that is still hiring wins, then one that
  // is paused, then one that is closed. Within a tier the (createdAt,
  // id) order above decides.
  const rank = (row: PublicRequisition): number => {
    const state = stateFor(row)
    if (state === 'OPEN') return 0
    if (state === 'FILLED') return 1
    if (state === 'ON_HOLD') return 2
    if (state === 'DRAFT') return 3
    return 4
  }

  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b))
  const chosen = ordered[0]
  if (!chosen) {
    return { state: 'MISSING', hiringRequest: null, bound: false }
  }
  return { state: stateFor(chosen), hiringRequest: chosen, bound: false }
}
