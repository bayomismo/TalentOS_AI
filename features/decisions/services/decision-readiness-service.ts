/**
 * Sprint 8 — Decision Readiness service.
 *
 * Pure, deterministic, no Prisma, no I/O, no AI. Computes the
 * workflow-readiness status of a candidate based on what evidence is
 * available. This is NOT a hiring recommendation — it only tells the
 * user "here's what's still missing before you can make a fair call".
 *
 * Rules:
 *   - No AI analysis                       → NOT_READY
 *   - AI analyzed but no completed interview → NEEDS_INTERVIEW
 *   - Interview completed but no evaluation → AWAITING_EVALUATION
 *   - AI analysis + completed human evaluation → READY_FOR_REVIEW
 */

import type { DecisionReadiness } from '../types'

export interface ReadinessInput {
  hasMatchAnalysis: boolean
  hasCompletedInterview: boolean
  hasEvaluation: boolean
}

export function computeReadiness(input: ReadinessInput): DecisionReadiness {
  if (!input.hasMatchAnalysis) return 'NOT_READY'
  if (!input.hasCompletedInterview) return 'NEEDS_INTERVIEW'
  if (!input.hasEvaluation) return 'AWAITING_EVALUATION'
  return 'READY_FOR_REVIEW'
}

/**
 * Convenience: map a candidate row + their latest interview into the
 * readiness input. Keeps callers from re-implementing the rule.
 */
export function readinessFromCandidate(
  candidate: { matchScore: number | null },
  latestInterview: {
    status: string
    completedAt: Date | string | null
    evaluations: Array<unknown>
  } | null
): DecisionReadiness {
  return computeReadiness({
    hasMatchAnalysis: candidate.matchScore !== null,
    hasCompletedInterview: latestInterview !== null && latestInterview.status === 'COMPLETED',
    hasEvaluation: latestInterview !== null && latestInterview.evaluations.length > 0,
  })
}
