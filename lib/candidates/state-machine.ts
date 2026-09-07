/**
 * Sprint 18 — ApplicationStage state machine.
 *
 * Mirrors the offer state machine pattern from Sprint 10. Defends
 * against silent stage regressions (e.g. a bug moving a HIRED
 * candidate back to APPLIED).
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
 * Terminal states: HIRED, REJECTED, WITHDRAWN — no further transitions.
 *
 * Sprint 17.6 adds: when a public application comes in, the candidate
 * is created at stage=APPLIED. So APPLIED is a valid starting point.
 *
 * Sprint 18 audit: the bulk-move action and the public-apply action
 * both go through this validator before persisting.
 */
import { ApplicationStage } from '@prisma/client'

/**
 * Forward/backward transitions. The keys are the source stage; the
 * values are the legal destination stages.
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

export type StageTransitionCode =
  | `STAGE_${ApplicationStage}_TO_${ApplicationStage}`

export interface StageTransitionOk {
  ok: true
  nextStage: ApplicationStage
  code: StageTransitionCode
}

export interface StageTransitionFail {
  ok: false
  code: 'INVALID_TRANSITION'
  from: ApplicationStage
  to: ApplicationStage
  reason: string
}

export type StageTransitionResult = StageTransitionOk | StageTransitionFail

/**
 * Returns ok=true if `from → to` is a legal transition. Otherwise,
 * returns a typed rejection that callers MUST handle.
 */
export function validateStageTransition(
  from: ApplicationStage,
  to: ApplicationStage,
): StageTransitionResult {
  if (from === to) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      from,
      to,
      reason: `Candidate is already at stage ${from}.`,
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
  return { ok: true, nextStage: to, code: `STAGE_${from}_TO_${to}` as StageTransitionCode }
}

/**
 * Returns the list of stages this candidate can move to from the
 * current stage. Used by the UI to render action buttons. Always
 * empty for terminal stages.
 */
export function allowedNextStages(
  from: ApplicationStage,
): ReadonlyArray<ApplicationStage> {
  return ALLOWED[from] ?? []
}

/**
 * True if the stage is terminal (HIRED, REJECTED, WITHDRAWN). UI
 * uses this to show "no actions available" indicators.
 */
export function isTerminalStage(stage: ApplicationStage): boolean {
  return ALLOWED[stage]?.length === 0
}
