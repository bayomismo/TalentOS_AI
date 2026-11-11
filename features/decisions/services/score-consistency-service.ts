/**
 * Sprint 19 (audit P2-26) — score / recommendation consistency guard.
 *
 * The AI CV analysis produces a numeric match score and a categorical
 * recommendation INDEPENDENTLY. Nothing checked that the two agree, so
 * a brief could present `score: 92` next to `recommendation: REJECT` —
 * an internally contradictory document that a reviewer has to untangle.
 *
 * This module is pure and deterministic. It does not change the stored
 * analysis (the AI owns those values); it reports the contradiction so
 * the Decision Hub can flag it and the Decision Brief can warn the
 * reviewer before the decision is made.
 */

import { EvaluationRecommendation } from '@prisma/client'

export interface ConsistencyResult {
  /** True when the score and the recommendation agree (or there is nothing to compare). */
  consistent: boolean
  /** Human-readable explanation, or null when the pair is consistent. */
  warning: string | null
}

/**
 * Score bands used by the guard. A high score with a rejection, or a
 * low score with a hire, is the contradiction we care about; the middle
 * of the range is genuinely ambiguous and is left alone.
 */
export const HIGH_SCORE_THRESHOLD = 70
export const LOW_SCORE_THRESHOLD = 40

const POSITIVE_RECOMMENDATIONS: ReadonlySet<string> = new Set([
  EvaluationRecommendation.STRONG_HIRE,
  EvaluationRecommendation.HIRE,
])

const NEGATIVE_RECOMMENDATIONS: ReadonlySet<string> = new Set([
  EvaluationRecommendation.NO_HIRE,
  EvaluationRecommendation.STRONG_NO_HIRE,
])

/**
 * Returns true when the pair is contradictory.
 *
 *   score >= 70  + NO_HIRE / STRONG_NO_HIRE   → contradictory
 *   score <  40  + HIRE / STRONG_HIRE         → contradictory
 *
 * A missing score (never analysed) or a missing recommendation is NOT a
 * contradiction — there is simply nothing to compare.
 */
export function isScoreRecommendationConsistent(
  score: number | null,
  recommendation: EvaluationRecommendation | string | null,
): boolean {
  if (score === null || score === undefined) return true
  if (!recommendation) return true
  if (NEGATIVE_RECOMMENDATIONS.has(recommendation) && score >= HIGH_SCORE_THRESHOLD) {
    return false
  }
  if (POSITIVE_RECOMMENDATIONS.has(recommendation) && score < LOW_SCORE_THRESHOLD) {
    return false
  }
  return true
}

/**
 * The same check, with a message the reviewer can act on.
 */
export function checkScoreRecommendationConsistency(
  score: number | null,
  recommendation: EvaluationRecommendation | string | null,
): ConsistencyResult {
  if (isScoreRecommendationConsistent(score, recommendation)) {
    return { consistent: true, warning: null }
  }
  const rec = String(recommendation)
  const label = rec.replace(/_/g, ' ').toLowerCase()
  return {
    consistent: false,
    warning:
      `The stored CV match score (${score}) contradicts the stored recommendation (${label}). ` +
      'Treat both as unreliable — re-run the CV analysis before deciding.',
  }
}
