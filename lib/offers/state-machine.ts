/**
 * Sprint 10 — Offer State Machine (pure, testable).
 *
 * Centralized transition rules. The UI and the service layer both call
 * into this module. Invalid transitions are rejected with a typed code
 * (never an exception) so callers can surface a clean error to the user.
 *
 * Statuses:
 *   DRAFT
 *   PENDING_APPROVAL
 *   APPROVED
 *   ISSUED
 *   SENT             (legacy — preserved for backward compatibility)
 *   UNDER_REVIEW     (legacy — preserved for backward compatibility)
 *   ACCEPTED
 *   DECLINED
 *   WITHDRAWN
 *   EXPIRED
 *
 * Active statuses (block duplicate offer creation for same Candidate + HR):
 *   DRAFT, PENDING_APPROVAL, APPROVED, ISSUED, ACCEPTED
 *
 * Historical terminal statuses (allow a new offer):
 *   SENT, UNDER_REVIEW, DECLINED, WITHDRAWN, EXPIRED
 */

import { OfferStatus } from '@prisma/client'

export type OfferTransitionCode =
  | 'DRAFT_TO_PENDING_APPROVAL'
  | 'PENDING_APPROVAL_TO_APPROVED'
  | 'PENDING_APPROVAL_TO_DRAFT'
  | 'APPROVED_TO_ISSUED'
  | 'ISSUED_TO_ACCEPTED'
  | 'ISSUED_TO_DECLINED'
  | 'ISSUED_TO_WITHDRAWN'
  | 'ISSUED_TO_EXPIRED'
  | 'PENDING_APPROVAL_TO_RETURNED_FOR_CHANGES'

export type OfferTransitionResult =
  | { ok: true; nextStatus: OfferStatus; code: OfferTransitionCode }
  | { ok: false; code: 'INVALID_TRANSITION'; from: OfferStatus; to: OfferStatus; reason: string }

/**
 * The single source of truth for the offer state machine. The `reason`
 * string is for developer-facing logs and is NEVER surfaced verbatim to
 * the end user — the UI layer translates it.
 */
const ALLOWED: Record<OfferStatus, ReadonlyArray<OfferStatus>> = {
  [OfferStatus.DRAFT]: [
    OfferStatus.PENDING_APPROVAL,
  ],
  [OfferStatus.PENDING_APPROVAL]: [
    OfferStatus.APPROVED,
    OfferStatus.DRAFT, // returned for changes
  ],
  [OfferStatus.APPROVED]: [
    OfferStatus.ISSUED,
  ],
  [OfferStatus.ISSUED]: [
    OfferStatus.ACCEPTED,
    OfferStatus.DECLINED,
    OfferStatus.WITHDRAWN,
    OfferStatus.EXPIRED,
  ],
  // Legacy statuses preserved for backward compatibility
  [OfferStatus.SENT]: [
    OfferStatus.ACCEPTED,
    OfferStatus.DECLINED,
    OfferStatus.WITHDRAWN,
    OfferStatus.EXPIRED,
  ],
  [OfferStatus.UNDER_REVIEW]: [
    OfferStatus.ACCEPTED,
    OfferStatus.DECLINED,
    OfferStatus.WITHDRAWN,
    OfferStatus.EXPIRED,
  ],
  // Terminal statuses — no further transitions allowed
  [OfferStatus.ACCEPTED]: [],
  [OfferStatus.DECLINED]: [],
  [OfferStatus.WITHDRAWN]: [],
  [OfferStatus.EXPIRED]: [],
}

const ACTIVE_STATUSES: ReadonlySet<OfferStatus> = new Set([
  OfferStatus.DRAFT,
  OfferStatus.PENDING_APPROVAL,
  OfferStatus.APPROVED,
  OfferStatus.ISSUED,
  OfferStatus.ACCEPTED,
])

/**
 * Returns true if the offer is in a workflow state that should block
 * the creation of a new offer for the same candidate + hiring request.
 *
 * Per the user's clarification: DRAFT, PENDING_APPROVAL, APPROVED, ISSUED,
 * and ACCEPTED all block. Only terminal historical statuses (DECLINED,
 * WITHDRAWN, EXPIRED, plus legacy SENT/UNDER_REVIEW) allow a new offer.
 */
export function isActiveOfferStatus(status: OfferStatus): boolean {
  return ACTIVE_STATUSES.has(status)
}

/**
 * Returns the explicit code if the transition is allowed, or a typed
 * rejection. Callers MUST handle the `ok: false` case.
 */
export function validateTransition(
  from: OfferStatus,
  to: OfferStatus,
): OfferTransitionResult {
  if (from === to) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      from,
      to,
      reason: `Already in status ${from}.`,
    }
  }
  const allowed = ALLOWED[from] ?? []
  if (!allowed.includes(to)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      from,
      to,
      reason: `Cannot transition from ${from} to ${to}. Allowed next: ${allowed.length === 0 ? '(terminal)' : allowed.join(', ')}.`,
    }
  }
  const code = deriveCode(from, to)
  return { ok: true, nextStatus: to, code }
}

function deriveCode(from: OfferStatus, to: OfferStatus): OfferTransitionCode {
  const key = `${from}_TO_${to}` as OfferTransitionCode
  return key
}

/**
 * Returns the list of statuses this offer can move to. Used by the UI
 * to render action buttons. Always empty for terminal statuses.
 */
export function allowedNextStatuses(from: OfferStatus): ReadonlyArray<OfferStatus> {
  return ALLOWED[from] ?? []
}

/**
 * Returns true if the offer is in a terminal state (no further
 * transitions allowed). Used for UI labels ("Offer accepted — no
 * further action available").
 */
export function isTerminalStatus(status: OfferStatus): boolean {
  return (ALLOWED[status] ?? []).length === 0
}
