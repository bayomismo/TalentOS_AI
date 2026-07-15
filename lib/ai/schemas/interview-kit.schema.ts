/**
 * Interview Kit — structured output schema.
 *
 * Used by `AIEngine.generateInterviewKit()`. Returns a complete
 * personalized interview kit: overview, candidate snapshot, all the
 * questions (opening, role-specific, skill-validation, gap-validation,
 * behavioral, scenario, candidate-specific, closing), and the scorecard
 * criteria with weights.
 *
 * The application computes the final interview score deterministically
 * from the criteria + scores. Gemini does NOT compute the final score.
 *
 * NOTE: This schema is shaped to fit Gemini's responseJsonSchema
 * complexity budget. The `guidance` nested object bundles the
 * evaluator-facing details (strong signals, red flags) so we don't
 * exceed the per-object property limit. `suggestedFollowUp` and
 * `difficulty` are inlined as part of `strongAnswer`; the action layer
 * re-parses them out for the UI.
 */

import { z } from 'zod'

const purposeSchema = z.enum([
  'OPENING',
  'ROLE_SPECIFIC',
  'SKILL_VALIDATION',
  'GAP_VALIDATION',
  'BEHAVIORAL',
  'SCENARIO',
  'CANDIDATE_SPECIFIC',
  'CLOSING',
])

const questionSchema = z.object({
  purpose: purposeSchema,
  category: z.string().min(1).max(80),
  /** The actual question, phrased in interview form. */
  question: z.string().min(10).max(800),
  /**
   * Why this question is being asked for THIS candidate, plus the
   * competency it evaluates (e.g. "Tests senior-level React + SSR
   * fluency — the candidate claims strong React but no Next.js
   * evidence in the CV"). The first sentence is the "why"; the
   * remainder is the evaluated competency.
   */
  whyThisQuestion: z.string().min(10).max(800),
  guidance: z.object({
    /**
     * Observable indicators of a strong answer. Optionally ends with
     * a single line "Follow-up: <question>" and a single line
     * "Difficulty: <EASY|MEDIUM|HARD|EXPERT>". The action layer
     * extracts these for the UI.
     */
    strongAnswer: z.string().min(10).max(1200),
    /** Red flags / weak signals to watch for. */
    redFlags: z.string().min(5).max(800),
  }),
})

const scorecardCriterionSchema = z.object({
  /** Stable name, used as the JSON key for the score. */
  name: z.string().min(1).max(80),
  description: z.string().min(5).max(400),
  /** Percentage weight. The application will validate the sum to 100. */
  weight: z.number().int().min(0).max(100),
  /**
   * Observable indicators at the extremes. The "meets expectations"
   * (3/5) indicator is the midpoint between poor and excellent and
   * is computed in the UI.
   */
  indicators: z.object({
    poor: z.string().min(5).max(400),
    excellent: z.string().min(5).max(400),
  }),
})

const overviewSchema = z.object({
  candidateName: z.string().min(1),
  position: z.string().min(1),
  recommendedType: z.enum([
    'PHONE_SCREEN',
    'TECHNICAL',
    'BEHAVIORAL',
    'PANEL',
    'ONSITE',
    'FINAL',
    'CULTURE_FIT',
    'CASE_STUDY',
  ]),
  recommendedDurationMinutes: z.number().int().min(15).max(240),
  /**
   * 2-3 sentence summary explaining the interview focus for this
   * specific candidate, based on their match analysis (strengths, gaps,
   * concerns).
   */
  interviewFocus: z.string().min(20).max(1200),
})

const candidateSnapshotSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  /** Re-stated top strengths the interviewer should validate. */
  keyStrengths: z.array(z.string().min(2).max(200)).min(1).max(6),
  /** Re-stated top gaps the interviewer should probe. */
  keyGaps: z.array(z.string().min(2).max(200)).min(0).max(6),
  /** Areas requiring validation (claims the candidate made on the CV). */
  areasRequiringValidation: z.array(z.string().min(2).max(200)).min(0).max(8),
})

export const interviewKitOutputSchema = z.object({
  overview: overviewSchema,
  candidateSnapshot: candidateSnapshotSchema,
  questions: z.array(questionSchema).min(8).max(20),
  scorecardCriteria: z.array(scorecardCriterionSchema).min(3).max(10),
})

export type InterviewKitOutput = z.infer<typeof interviewKitOutputSchema>
export type InterviewKitQuestion = z.infer<typeof questionSchema>
export type InterviewKitScorecardCriterion = z.infer<typeof scorecardCriterionSchema>
export type InterviewKitOverview = z.infer<typeof overviewSchema>
export type InterviewKitCandidateSnapshot = z.infer<typeof candidateSnapshotSchema>

/**
 * Optional, extracted fields that the action layer pulls out of
 * `guidance.strongAnswer` for the UI.
 */
export interface ExtractedQuestionMeta {
  suggestedFollowUp: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT'
}

/**
 * Pulls the optional "Follow-up: ..." and "Difficulty: ..." trailers
 * out of `guidance.strongAnswer`. Mutates the input is not done; we
 * return a clean copy.
 */
export function extractQuestionMeta(strongAnswer: string): ExtractedQuestionMeta {
  const lines = strongAnswer.split(/\r?\n/)
  const meta: ExtractedQuestionMeta = { suggestedFollowUp: '', difficulty: 'MEDIUM' }
  const remaining: string[] = []
  for (const line of lines) {
    const followMatch = line.match(/^\s*Follow-up\s*:\s*(.+)$/i)
    const diffMatch = line.match(/^\s*Difficulty\s*:\s*(EASY|MEDIUM|HARD|EXPERT)\s*$/i)
    if (followMatch) {
      meta.suggestedFollowUp = followMatch[1].trim()
    } else if (diffMatch) {
      meta.difficulty = diffMatch[1].toUpperCase() as ExtractedQuestionMeta['difficulty']
    } else {
      remaining.push(line)
    }
  }
  return meta
}
