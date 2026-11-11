/**
 * Sprint 8 — Decision Readiness service.
 *
 * Pure, deterministic, no Prisma, no I/O, no AI. Computes the
 * workflow-readiness status of a candidate based on what evidence is
 * available. This is NOT a hiring recommendation — it only tells the
 * user "here's what's still missing before you can make a fair call".
 *
 * Sprint 19 (audit P2-17) — the rules changed:
 *
 *   - The AI CV analysis is NO LONGER a gate. The old rule returned
 *     NOT_READY whenever `matchScore === null`, which trapped every
 *     un-analysed candidate in a permanent "Not Ready" state: the
 *     reviewer never saw them as ready, even after their interview was
 *     completed and evaluated. The analysis is now reported separately
 *     (as `NOT_ANALYZED`) and never blocks a review.
 *   - A terminal candidate (HIRED / REJECTED / WITHDRAWN) is DECIDED:
 *     there is nothing left to decide.
 *
 * Rules:
 *   - Terminal stage                        → DECIDED
 *   - No completed interview                → NEEDS_INTERVIEW
 *   - Interview completed, no evaluation    → AWAITING_EVALUATION
 *   - Interview completed + evaluation      → READY_FOR_REVIEW
 *   - (no evidence at all)                  → NOT_READY
 */

import type { DecisionReadiness } from '../types'

export interface ReadinessInput {
  /** True when the candidate is in a terminal stage (no decision left). */
  isTerminal?: boolean
  hasMatchAnalysis: boolean
  hasCompletedInterview: boolean
  hasEvaluation: boolean
}

export function computeReadiness(input: ReadinessInput): DecisionReadiness {
  if (input.isTerminal) return 'DECIDED'
  if (!input.hasCompletedInterview) {
    // No completed interview. The AI analysis (if any) does not change
    // what is missing — the interview is.
    return 'NEEDS_INTERVIEW'
  }
  if (!input.hasEvaluation) return 'AWAITING_EVALUATION'
  return 'READY_FOR_REVIEW'
}

/**
 * Convenience: map a candidate row + their latest interview into the
 * readiness input. Keeps callers from re-implementing the rule.
 */
export function readinessFromCandidate(
  candidate: { matchScore: number | null; stage?: string },
  latestInterview: {
    status: string
    completedAt: Date | string | null
    evaluations: Array<unknown>
  } | null,
): DecisionReadiness {
  return computeReadiness({
    isTerminal:
      candidate.stage !== undefined &&
      (candidate.stage === 'HIRED' ||
        candidate.stage === 'REJECTED' ||
        candidate.stage === 'WITHDRAWN'),
    // Kept for the input contract, but no longer a gate — see the note
    // above. It is still passed so a future rule can use it.
    hasMatchAnalysis: candidate.matchScore !== null,
    hasCompletedInterview: latestInterview !== null && latestInterview.status === 'COMPLETED',
    hasEvaluation: latestInterview !== null && latestInterview.evaluations.length > 0,
  })
}
