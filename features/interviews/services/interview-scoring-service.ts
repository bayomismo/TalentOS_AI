/**
 * Sprint 8 — Deterministic interview scoring.
 *
 * Pure functions. NO Prisma, NO I/O. The final interview score (0–100) is
 * computed by this service from the AI-generated scorecard weights and
 * the interviewer's per-criterion scores. AI is never trusted to compute
 * the final score.
 *
 * Formula:
 *   interviewScore = round( Σ (criterionScore / 5) × criterionWeight )
 *
 * Validation:
 *   - Every criterion has a 1–5 integer score.
 *   - Weights sum to exactly 100.
 */

import type { InterviewKitOutput } from '@/lib/ai/schemas/interview-kit.schema'

export interface ScoringResult {
  /** Weighted 0-100 score. */
  interviewScore: number
  /** Average of criterion scores, rounded — for the legacy column. */
  overallScore: number
  /** Per-criterion scores, validated. */
  criterionScores: Record<string, number>
}

export type ScoringError =
  | { code: 'INVALID_SCORES'; message: string; details: string[] }
  | { code: 'INVALID_WEIGHTS'; message: string }

export function computeScoring(
  snapshot: InterviewKitOutput,
  criterionScores: Record<string, number>
): { ok: true; data: ScoringResult } | { ok: false; error: ScoringError } {
  const weightSum = snapshot.scorecardCriteria.reduce((a, c) => a + c.weight, 0)
  if (weightSum !== 100) {
    return {
      ok: false,
      error: {
        code: 'INVALID_WEIGHTS',
        message: `Scorecard weights do not sum to 100 (got ${weightSum}).`,
      },
    }
  }

  const errors: string[] = []
  for (const c of snapshot.scorecardCriteria) {
    const s = criterionScores[c.name]
    if (s === undefined || s === null) {
      errors.push(`Missing score for "${c.name}"`)
      continue
    }
    if (!Number.isInteger(s) || s < 1 || s > 5) {
      errors.push(`Invalid score for "${c.name}" (must be integer 1-5, got ${s})`)
    }
  }
  if (errors.length > 0) {
    return {
      ok: false,
      error: {
        code: 'INVALID_SCORES',
        message: errors.join('; '),
        details: errors,
      },
    }
  }

  let interviewScore = 0
  for (const c of snapshot.scorecardCriteria) {
    const s = criterionScores[c.name] as number
    interviewScore += (s / 5) * c.weight
  }
  interviewScore = Math.round(interviewScore)

  const scores = Object.values(criterionScores)
  const overallScore = Math.round(scores.reduce((a, s) => a + s, 0) / scores.length)

  return {
    ok: true,
    data: {
      interviewScore,
      overallScore,
      criterionScores,
    },
  }
}
