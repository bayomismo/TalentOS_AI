/**
 * Sprint 19 — HiringRequest state machine (pure, testable).
 *
 * Mirrors the offer state machine pattern from Sprint 10. Centralized
 * transition rules with typed rejection codes (never an exception) so
 * callers can surface a clean error to the user.
 *
 * Statuses:
 *   DRAFT
 *   OPEN
 *   ON_HOLD
 *   CLOSED
 *   FILLED
 *   CANCELLED
 *
 * Lifecycle (the happy path):
 *
 *   DRAFT → OPEN → FILLED
 *
 * A requisition can be paused and resumed:
 *
 *   OPEN → ON_HOLD → OPEN
 *
 * Closure is reversible — a CLOSED or FILLED requisition can be
 * reopened when the budget comes back or a candidate falls through:
 *
 *   CLOSED → OPEN
 *   FILLED → OPEN
 *
 * Terminal states: CLOSED, FILLED, CANCELLED — no further transitions.
 *
 * Audit P1-17: before this machine existed, ON_HOLD, CLOSED, FILLED
 * and CANCELLED were unreachable in application code, so the "Closed"
 * filter on the hiring-requests list always returned zero rows.
 */

import { HiringRequestStatus } from '@prisma/client'

export type HiringRequestTransitionCode =
  | 'DRAFT_TO_OPEN'
  | 'DRAFT_TO_CANCELLED'
  | 'OPEN_TO_ON_HOLD'
  | 'OPEN_TO_CLOSED'
  | 'OPEN_TO_FILLED'
  | 'OPEN_TO_CANCELLED'
  | 'ON_HOLD_TO_OPEN'
  | 'ON_HOLD_TO_CLOSED'
  | 'ON_HOLD_TO_CANCELLED'
  | 'CLOSED_TO_OPEN'
  | 'FILLED_TO_OPEN'
  | 'CANCELLED_TO_DRAFT'

export type HiringRequestTransitionResult =
  | { ok: true; nextStatus: HiringRequestStatus; code: HiringRequestTransitionCode }
  | {
      ok: false
      code: 'INVALID_TRANSITION'
      from: HiringRequestStatus
      to: HiringRequestStatus
      reason: string
    }

/**
 * The single source of truth for the hiring-request state machine. The
 * `reason` string is for developer-facing logs and is NEVER surfaced
 * verbatim to the end user — the UI layer translates it.
 */
const ALLOWED: Record<HiringRequestStatus, ReadonlyArray<HiringRequestStatus>> = {
  [HiringRequestStatus.DRAFT]: [
    HiringRequestStatus.OPEN,
    HiringRequestStatus.CANCELLED,
  ],
  [HiringRequestStatus.OPEN]: [
    HiringRequestStatus.ON_HOLD,
    HiringRequestStatus.CLOSED,
    HiringRequestStatus.FILLED,
    HiringRequestStatus.CANCELLED,
  ],
  [HiringRequestStatus.ON_HOLD]: [
    HiringRequestStatus.OPEN,
    HiringRequestStatus.CLOSED,
    HiringRequestStatus.CANCELLED,
  ],
  [HiringRequestStatus.CLOSED]: [
    HiringRequestStatus.OPEN,
  ],
  [HiringRequestStatus.FILLED]: [
    HiringRequestStatus.OPEN,
  ],
  [HiringRequestStatus.CANCELLED]: [
    HiringRequestStatus.DRAFT,
  ],
}

/**
 * Code for every legal edge. Kept next to ALLOWED so the vocabulary of
 * transition codes and the vocabulary of legal transitions cannot drift.
 * `scripts/audit-7-state-machines.ts` asserts that the two agree.
 */
const CODES: Record<
  HiringRequestStatus,
  Partial<Record<HiringRequestStatus, HiringRequestTransitionCode>>
> = {
  [HiringRequestStatus.DRAFT]: {
    [HiringRequestStatus.OPEN]: 'DRAFT_TO_OPEN',
    [HiringRequestStatus.CANCELLED]: 'DRAFT_TO_CANCELLED',
  },
  [HiringRequestStatus.OPEN]: {
    [HiringRequestStatus.ON_HOLD]: 'OPEN_TO_ON_HOLD',
    [HiringRequestStatus.CLOSED]: 'OPEN_TO_CLOSED',
    [HiringRequestStatus.FILLED]: 'OPEN_TO_FILLED',
    [HiringRequestStatus.CANCELLED]: 'OPEN_TO_CANCELLED',
  },
  [HiringRequestStatus.ON_HOLD]: {
    [HiringRequestStatus.OPEN]: 'ON_HOLD_TO_OPEN',
    [HiringRequestStatus.CLOSED]: 'ON_HOLD_TO_CLOSED',
    [HiringRequestStatus.CANCELLED]: 'ON_HOLD_TO_CANCELLED',
  },
  [HiringRequestStatus.CLOSED]: {
    [HiringRequestStatus.OPEN]: 'CLOSED_TO_OPEN',
  },
  [HiringRequestStatus.FILLED]: {
    [HiringRequestStatus.OPEN]: 'FILLED_TO_OPEN',
  },
  [HiringRequestStatus.CANCELLED]: {
    [HiringRequestStatus.DRAFT]: 'CANCELLED_TO_DRAFT',
  },
}

/**
 * Returns the explicit code if the transition is allowed, or a typed
 * rejection. Callers MUST handle the `ok: false` case.
 */
export function validateHiringRequestTransition(
  from: HiringRequestStatus,
  to: HiringRequestStatus,
): HiringRequestTransitionResult {
  if (from === to) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      from,
      to,
      reason: `Hiring request is already in status ${from}.`,
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
 * Returns the list of statuses this hiring request can move to. Used by
 * the UI to render action buttons. Always empty for terminal statuses.
 */
export function allowedNextHiringRequestStatuses(
  from: HiringRequestStatus,
): ReadonlyArray<HiringRequestStatus> {
  return ALLOWED[from] ?? []
}

/**
 * Returns true if the hiring request is in a terminal state (no further
 * transitions allowed).
 */
export function isTerminalHiringRequestStatus(status: HiringRequestStatus): boolean {
  return (ALLOWED[status] ?? []).length === 0
}
