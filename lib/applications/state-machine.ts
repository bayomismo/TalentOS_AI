/**
 * Sprint 19 — Application state machine (pure, testable).
 *
 * Mirrors the offer state machine pattern from Sprint 10. Centralized
 * transition rules with typed rejection codes (never an exception) so
 * callers can surface a clean error to the user.
 *
 * Statuses: the existing `ApplicationStage` Prisma enum —
 *   APPLIED, SCREENING, INTERVIEW, OFFER, HIRED, REJECTED, WITHDRAWN
 *
 * Lifecycle (the happy path):
 *
 *   APPLIED → SCREENING → INTERVIEW → OFFER → HIRED
 *
 * Rejection can happen from any non-terminal stage:
 *
 *   {APPLIED, SCREENING, INTERVIEW, OFFER} → REJECTED
 *
 * Withdrawal is the candidate opting out:
 *
 *   {APPLIED, SCREENING, INTERVIEW, OFFER} → WITHDRAWN
 *
 * One step back is allowed after an interview — a candidate can be
 * returned to screening when the panel asks for a second round:
 *
 *   INTERVIEW → SCREENING
 *
 * Terminal states: HIRED, REJECTED, WITHDRAWN — no further transitions.
 *
 * Audit P1-16: `Application` is the person × requisition record. This
 * machine governs the per-application lifecycle, which used to live on
 * the shared, mutable `Candidate` row.
 */

import { ApplicationStage } from '@prisma/client'

export type ApplicationTransitionCode =
  | 'APPLIED_TO_SCREENING'
  | 'APPLIED_TO_REJECTED'
  | 'APPLIED_TO_WITHDRAWN'
  | 'SCREENING_TO_INTERVIEW'
  | 'SCREENING_TO_REJECTED'
  | 'SCREENING_TO_WITHDRAWN'
  | 'INTERVIEW_TO_OFFER'
  | 'INTERVIEW_TO_SCREENING'
  | 'INTERVIEW_TO_REJECTED'
  | 'INTERVIEW_TO_WITHDRAWN'
  | 'OFFER_TO_HIRED'
  | 'OFFER_TO_REJECTED'
  | 'OFFER_TO_WITHDRAWN'

export type ApplicationTransitionResult =
  | { ok: true; nextStage: ApplicationStage; code: ApplicationTransitionCode }
  | {
      ok: false
      code: 'INVALID_TRANSITION'
      from: ApplicationStage
      to: ApplicationStage
      reason: string
    }

/**
 * The single source of truth for the application state machine. The
 * `reason` string is for developer-facing logs and is NEVER surfaced
 * verbatim to the end user — the UI layer translates it.
 */
const ALLOWED: Record<ApplicationStage, ReadonlyArray<ApplicationStage>> = {
  [ApplicationStage.APPLIED]: [
    ApplicationStage.SCREENING,
    ApplicationStage.REJECTED,
    ApplicationStage.WITHDRAWN,
  ],
  [ApplicationStage.SCREENING]: [
    ApplicationStage.INTERVIEW,
    ApplicationStage.REJECTED,
    ApplicationStage.WITHDRAWN,
  ],
  [ApplicationStage.INTERVIEW]: [
    ApplicationStage.OFFER,
    ApplicationStage.SCREENING,
    ApplicationStage.REJECTED,
    ApplicationStage.WITHDRAWN,
  ],
  [ApplicationStage.OFFER]: [
    ApplicationStage.HIRED,
    ApplicationStage.REJECTED,
    ApplicationStage.WITHDRAWN,
  ],
  // Terminal states
  [ApplicationStage.HIRED]: [],
  [ApplicationStage.REJECTED]: [],
  [ApplicationStage.WITHDRAWN]: [],
}

/**
 * Code for every legal edge. Kept next to ALLOWED so the vocabulary of
 * transition codes and the vocabulary of legal transitions cannot drift.
 * `scripts/audit-7-state-machines.ts` asserts that the two agree.
 */
const CODES: Record<
  ApplicationStage,
  Partial<Record<ApplicationStage, ApplicationTransitionCode>>
> = {
  [ApplicationStage.APPLIED]: {
    [ApplicationStage.SCREENING]: 'APPLIED_TO_SCREENING',
    [ApplicationStage.REJECTED]: 'APPLIED_TO_REJECTED',
    [ApplicationStage.WITHDRAWN]: 'APPLIED_TO_WITHDRAWN',
  },
  [ApplicationStage.SCREENING]: {
    [ApplicationStage.INTERVIEW]: 'SCREENING_TO_INTERVIEW',
    [ApplicationStage.REJECTED]: 'SCREENING_TO_REJECTED',
    [ApplicationStage.WITHDRAWN]: 'SCREENING_TO_WITHDRAWN',
  },
  [ApplicationStage.INTERVIEW]: {
    [ApplicationStage.OFFER]: 'INTERVIEW_TO_OFFER',
    [ApplicationStage.SCREENING]: 'INTERVIEW_TO_SCREENING',
    [ApplicationStage.REJECTED]: 'INTERVIEW_TO_REJECTED',
    [ApplicationStage.WITHDRAWN]: 'INTERVIEW_TO_WITHDRAWN',
  },
  [ApplicationStage.OFFER]: {
    [ApplicationStage.HIRED]: 'OFFER_TO_HIRED',
    [ApplicationStage.REJECTED]: 'OFFER_TO_REJECTED',
    [ApplicationStage.WITHDRAWN]: 'OFFER_TO_WITHDRAWN',
  },
  [ApplicationStage.HIRED]: {},
  [ApplicationStage.REJECTED]: {},
  [ApplicationStage.WITHDRAWN]: {},
}

/**
 * Returns the explicit code if the transition is allowed, or a typed
 * rejection. Callers MUST handle the `ok: false` case.
 */
export function validateApplicationTransition(
  from: ApplicationStage,
  to: ApplicationStage,
): ApplicationTransitionResult {
  if (from === to) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      from,
      to,
      reason: `Application is already at stage ${from}.`,
    }
  }
  const allowed = ALLOWED[from] ?? []
  if (!allowed.includes(to)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      from,
      to,
      reason: `Cannot move from ${from} to ${to}. Allowed next: ${allowed.length === 0 ? '(terminal)' : allowed.join(', ')}.`,
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
      reason: `Cannot move from ${from} to ${to}.`,
    }
  }
  return { ok: true, nextStage: to, code }
}

/**
 * Returns the list of stages this application can move to. Used by the
 * UI to render action buttons. Always empty for terminal stages.
 */
export function allowedNextApplicationStages(
  from: ApplicationStage,
): ReadonlyArray<ApplicationStage> {
  return ALLOWED[from] ?? []
}

/**
 * True if the stage is terminal (HIRED, REJECTED, WITHDRAWN).
 */
export function isTerminalApplicationStage(stage: ApplicationStage): boolean {
  return (ALLOWED[stage] ?? []).length === 0
}
