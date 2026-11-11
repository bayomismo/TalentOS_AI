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
  | 'APPROVED_TO_WITHDRAWN'
  | 'APPROVED_TO_EXPIRED'
  | 'ISSUED_TO_ACCEPTED'
  | 'ISSUED_TO_DECLINED'
  | 'ISSUED_TO_WITHDRAWN'
  | 'ISSUED_TO_EXPIRED'
  | 'SENT_TO_ACCEPTED'
  | 'SENT_TO_DECLINED'
  | 'SENT_TO_WITHDRAWN'
  | 'SENT_TO_EXPIRED'
  | 'UNDER_REVIEW_TO_ACCEPTED'
  | 'UNDER_REVIEW_TO_DECLINED'
  | 'UNDER_REVIEW_TO_WITHDRAWN'
  | 'UNDER_REVIEW_TO_EXPIRED'

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
    // Audit P1-03: APPROVED was a one-way dead end. When the budget is
    // pulled or the candidate accepts elsewhere after approval, the offer
    // has to be cancellable — otherwise it stays APPROVED forever,
    // blocking a replacement offer and never reaching the
    // accepted/declined metrics.
    OfferStatus.WITHDRAWN,
    OfferStatus.EXPIRED,
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
 * Code for every legal edge. Kept next to ALLOWED so the vocabulary of
 * transition codes and the vocabulary of legal transitions cannot drift.
 *
 * Audit P3-03: `deriveCode()` used to compose the code with an `as`
 * cast, so it could return codes that were never declared in
 * `OfferTransitionCode` (`SENT_TO_ACCEPTED`, `UNDER_REVIEW_TO_*`), while
 * `PENDING_APPROVAL_TO_RETURNED_FOR_CHANGES` was declared but could
 * never be produced. Now the union lists exactly the codes this table
 * can return, and the table covers exactly the legal edges.
 */
const CODES: Record<
  OfferStatus,
  Partial<Record<OfferStatus, OfferTransitionCode>>
> = {
  [OfferStatus.DRAFT]: {
    [OfferStatus.PENDING_APPROVAL]: 'DRAFT_TO_PENDING_APPROVAL',
  },
  [OfferStatus.PENDING_APPROVAL]: {
    [OfferStatus.APPROVED]: 'PENDING_APPROVAL_TO_APPROVED',
    [OfferStatus.DRAFT]: 'PENDING_APPROVAL_TO_DRAFT',
  },
  [OfferStatus.APPROVED]: {
    [OfferStatus.ISSUED]: 'APPROVED_TO_ISSUED',
    [OfferStatus.WITHDRAWN]: 'APPROVED_TO_WITHDRAWN',
    [OfferStatus.EXPIRED]: 'APPROVED_TO_EXPIRED',
  },
  [OfferStatus.ISSUED]: {
    [OfferStatus.ACCEPTED]: 'ISSUED_TO_ACCEPTED',
    [OfferStatus.DECLINED]: 'ISSUED_TO_DECLINED',
    [OfferStatus.WITHDRAWN]: 'ISSUED_TO_WITHDRAWN',
    [OfferStatus.EXPIRED]: 'ISSUED_TO_EXPIRED',
  },
  // Legacy statuses preserved for backward compatibility
  [OfferStatus.SENT]: {
    [OfferStatus.ACCEPTED]: 'SENT_TO_ACCEPTED',
    [OfferStatus.DECLINED]: 'SENT_TO_DECLINED',
    [OfferStatus.WITHDRAWN]: 'SENT_TO_WITHDRAWN',
    [OfferStatus.EXPIRED]: 'SENT_TO_EXPIRED',
  },
  [OfferStatus.UNDER_REVIEW]: {
    [OfferStatus.ACCEPTED]: 'UNDER_REVIEW_TO_ACCEPTED',
    [OfferStatus.DECLINED]: 'UNDER_REVIEW_TO_DECLINED',
    [OfferStatus.WITHDRAWN]: 'UNDER_REVIEW_TO_WITHDRAWN',
    [OfferStatus.EXPIRED]: 'UNDER_REVIEW_TO_EXPIRED',
  },
  // Terminal statuses — no further transitions allowed
  [OfferStatus.ACCEPTED]: {},
  [OfferStatus.DECLINED]: {},
  [OfferStatus.WITHDRAWN]: {},
  [OfferStatus.EXPIRED]: {},
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
  const code = CODES[from][to]
  if (code === undefined) {
    // Unreachable while ALLOWED and CODES agree. If they ever drift the
    // transition is refused rather than reported with a code that was
    // never declared.
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      from,
      to,
      reason: `Cannot transition from ${from} to ${to}.`,
    }
  }
  return { ok: true, nextStatus: to, code }
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
