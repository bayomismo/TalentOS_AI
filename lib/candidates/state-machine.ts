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
 * ENFORCEMENT TODAY (Sprint 19 business-flow audit — read this before
 * assuming a stage write is validated):
 *
 *   - ENFORCED: every candidate stage write in this track goes through
 *     `lib/candidates/transition.ts` → `transitionCandidateStage`, which
 *     calls this validator BEFORE it writes:
 *       · the single-candidate move action (`moveCandidateStageAction`),
 *       · the bulk-move action (`bulkMoveCandidatesAction`),
 *       · the CV-upload path (`uploadCVsAction` — it no longer writes a
 *         stage at all, see P2-03/P2-04 below).
 *   - ENFORCED: the UI offers only the legal next stages. The server
 *     computes `allowedNextStages(stage)` and ships it to the client, so
 *     a terminal candidate has no "Move stage" menu and a terminal
 *     candidate's bulk-select checkbox is disabled (audit P0-09/P0-10).
 *   - STILL NOT ENFORCED: the public-apply action
 *     (`app/(public)/jobs/[slug]/apply-action.ts`) writes `stage:
 *     'APPLIED'` straight onto the candidate row and imports no state
 *     machine at all. It is owned by the fix-public-apply track.
 *   - STILL NOT ENFORCED: `features/interviews/services/interview-kit-service.ts`
 *     writes `stage: 'INTERVIEW'` directly when a kit is generated,
 *     bypassing both this validator and the `Candidate.status` mirror.
 *     It is outside the candidate track's file ownership.
 *
 * The earlier header comment claimed that "the bulk-move action and the
 * public-apply action both go through this validator". That was false:
 * only the bulk-move action did.
 *
 * `lib/candidates/transition.ts` is the shared helper that fixes this.
 * Call it instead of writing `stage` directly — it validates, mirrors the
 * lifecycle timestamps and keeps the `Application` row in sync. It does
 * NOT write the `Candidate.status` mirror: the caller pairs it with
 * `syncCandidateStatus` from `lib/candidates/status.ts`, because the
 * mirror is a SEPARATE column with its own contract.
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

/**
 * The terminal stages, derived from the transition table so the set can
 * never drift from `ALLOWED`.
 */
const TERMINAL_STAGES: ReadonlySet<string> = new Set(
  Object.values(ApplicationStage).filter((stage) => ALLOWED[stage].length === 0),
)

/**
 * String-typed twin of `isTerminalStage`, for callers that hold a raw
 * string (a form value, a JSON payload, a `stage` read back from a
 * query) rather than the `ApplicationStage` enum.
 *
 * Behaviour is identical to `isTerminalStage` for every value of the
 * enum; `scripts/audit-7-state-machines.ts` asserts that the two agree.
 */
export function isTerminalApplicationStage(stage: string): boolean {
  return TERMINAL_STAGES.has(stage)
}

/**
 * True when the candidate may still be decided on or offered a job —
 * i.e. the candidate is NOT in a terminal stage.
 *
 * Audit P0-10: a candidate in REJECTED, WITHDRAWN or HIRED still
 * appeared in the Decision Hub, could be marked SELECTED and could be
 * issued an offer. Guard those flows with this function.
 *
 * Note: the check is on the terminal stages only. A candidate whose
 * stage is APPLIED, SCREENING, INTERVIEW or OFFER may still be decided.
 */
export function canReceiveDecisionOrOffer(stage: string): boolean {
  return !isTerminalApplicationStage(stage)
}
