/**
 * Sprint 19 — Interview state machine (pure, testable).
 *
 * Mirrors the offer state machine pattern from Sprint 10. Centralized
 * transition rules with typed rejection codes (never an exception) so
 * callers can surface a clean error to the user.
 *
 * Statuses:
 *   SCHEDULED
 *   IN_PROGRESS
 *   COMPLETED
 *   CANCELLED
 *   NO_SHOW
 *   RESCHEDULED
 *
 * Lifecycle (the happy path):
 *
 *   SCHEDULED → IN_PROGRESS → COMPLETED
 *
 * A scheduled interview can be rescheduled, cancelled or marked as a
 * no-show before or during the session:
 *
 *   SCHEDULED → RESCHEDULED → SCHEDULED
 *   SCHEDULED → CANCELLED
 *   SCHEDULED → NO_SHOW
 *
 * Terminal states: COMPLETED, CANCELLED — no further transitions.
 *
 * Audit P1-08: before this machine existed, CANCELLED, NO_SHOW and
 * RESCHEDULED had no reachable write path, so an interview that the
 * candidate cancelled stayed SCHEDULED forever and its reminders kept
 * firing.
 */

import { InterviewStatus } from '@prisma/client'

export type InterviewTransitionCode =
  | 'SCHEDULED_TO_IN_PROGRESS'
  | 'SCHEDULED_TO_CANCELLED'
  | 'SCHEDULED_TO_NO_SHOW'
  | 'SCHEDULED_TO_RESCHEDULED'
  | 'RESCHEDULED_TO_SCHEDULED'
  | 'RESCHEDULED_TO_CANCELLED'
  | 'RESCHEDULED_TO_NO_SHOW'
  | 'IN_PROGRESS_TO_COMPLETED'
  | 'IN_PROGRESS_TO_CANCELLED'
  | 'IN_PROGRESS_TO_NO_SHOW'
  | 'NO_SHOW_TO_RESCHEDULED'

export type InterviewTransitionResult =
  | { ok: true; nextStatus: InterviewStatus; code: InterviewTransitionCode }
  | {
      ok: false
      code: 'INVALID_TRANSITION'
      from: InterviewStatus
      to: InterviewStatus
      reason: string
    }

/**
 * The single source of truth for the interview state machine. The
 * `reason` string is for developer-facing logs and is NEVER surfaced
 * verbatim to the end user — the UI layer translates it.
 */
const ALLOWED: Record<InterviewStatus, ReadonlyArray<InterviewStatus>> = {
  [InterviewStatus.SCHEDULED]: [
    InterviewStatus.IN_PROGRESS,
    InterviewStatus.CANCELLED,
    InterviewStatus.NO_SHOW,
    InterviewStatus.RESCHEDULED,
  ],
  [InterviewStatus.RESCHEDULED]: [
    InterviewStatus.SCHEDULED,
    InterviewStatus.CANCELLED,
    InterviewStatus.NO_SHOW,
  ],
  [InterviewStatus.IN_PROGRESS]: [
    InterviewStatus.COMPLETED,
    InterviewStatus.CANCELLED,
    InterviewStatus.NO_SHOW,
  ],
  [InterviewStatus.NO_SHOW]: [
    InterviewStatus.RESCHEDULED,
  ],
  // Terminal states
  [InterviewStatus.COMPLETED]: [],
  [InterviewStatus.CANCELLED]: [],
}

/**
 * Code for every legal edge. Kept next to ALLOWED so the vocabulary of
 * transition codes and the vocabulary of legal transitions cannot drift.
 * `scripts/audit-7-state-machines.ts` asserts that the two agree.
 */
const CODES: Record<
  InterviewStatus,
  Partial<Record<InterviewStatus, InterviewTransitionCode>>
> = {
  [InterviewStatus.SCHEDULED]: {
    [InterviewStatus.IN_PROGRESS]: 'SCHEDULED_TO_IN_PROGRESS',
    [InterviewStatus.CANCELLED]: 'SCHEDULED_TO_CANCELLED',
    [InterviewStatus.NO_SHOW]: 'SCHEDULED_TO_NO_SHOW',
    [InterviewStatus.RESCHEDULED]: 'SCHEDULED_TO_RESCHEDULED',
  },
  [InterviewStatus.RESCHEDULED]: {
    [InterviewStatus.SCHEDULED]: 'RESCHEDULED_TO_SCHEDULED',
    [InterviewStatus.CANCELLED]: 'RESCHEDULED_TO_CANCELLED',
    [InterviewStatus.NO_SHOW]: 'RESCHEDULED_TO_NO_SHOW',
  },
  [InterviewStatus.IN_PROGRESS]: {
    [InterviewStatus.COMPLETED]: 'IN_PROGRESS_TO_COMPLETED',
    [InterviewStatus.CANCELLED]: 'IN_PROGRESS_TO_CANCELLED',
    [InterviewStatus.NO_SHOW]: 'IN_PROGRESS_TO_NO_SHOW',
  },
  [InterviewStatus.NO_SHOW]: {
    [InterviewStatus.RESCHEDULED]: 'NO_SHOW_TO_RESCHEDULED',
  },
  [InterviewStatus.COMPLETED]: {},
  [InterviewStatus.CANCELLED]: {},
}

/**
 * Returns the explicit code if the transition is allowed, or a typed
 * rejection. Callers MUST handle the `ok: false` case.
 */
export function validateInterviewTransition(
  from: InterviewStatus,
  to: InterviewStatus,
): InterviewTransitionResult {
  if (from === to) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      from,
      to,
      reason: `Interview is already in status ${from}.`,
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
 * Returns the list of statuses this interview can move to. Used by the
 * UI to render action buttons. Always empty for terminal statuses.
 */
export function allowedNextInterviewStatuses(
  from: InterviewStatus,
): ReadonlyArray<InterviewStatus> {
  return ALLOWED[from] ?? []
}

/**
 * Returns true if the interview is in a terminal state (no further
 * transitions allowed).
 */
export function isTerminalInterviewStatus(status: InterviewStatus): boolean {
  return (ALLOWED[status] ?? []).length === 0
}
