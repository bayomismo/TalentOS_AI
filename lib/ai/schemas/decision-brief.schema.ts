/**
 * Sprint 8 — AI Decision Brief output schema.
 *
 * Used by `AIEngine.generateDecisionBrief()`. Returns a structured
 * brief that helps a human HR user make a final hiring decision.
 *
 * The AI NEVER outputs a single combined hireability score, a
 * "best candidate", a "winner", or an autonomous hiring recommendation.
 * The brief explains evidence and trade-offs. The human user owns the
 * final decision.
 *
 * Output is shaped to fit Gemini's responseJsonSchema complexity budget
 * (per the lesson from the interview-kit refactor). The candidate
 * sub-objects are flat, with the criteria checklist nested under
 * `evidenceSupportingCandidacy` and `areasRequiringConsideration`.
 */

import { z } from 'zod'

const evidenceSourceSchema = z.enum([
  'CV',
  'AI_CV_ANALYSIS',
  'INTERVIEW_EVALUATION',
  'INTERVIEWER_NOTES',
  'SCORECARD',
])

const candidateBriefSchema = z.object({
  candidateId: z.string().min(1),
  candidateName: z.string().min(1),
  roleAlignment: z.string().min(10).max(800),
  keyAdvantages: z.array(z.string().min(2).max(400)).min(1).max(8),
  keyTradeoffs: z.array(z.string().min(2).max(400)).min(0).max(8),
  evidenceSupportingCandidacy: z.array(
    z.object({
      claim: z.string().min(5).max(400),
      source: evidenceSourceSchema,
    })
  ).min(0).max(12),
  areasRequiringConsideration: z.array(
    z.object({
      claim: z.string().min(5).max(400),
      source: evidenceSourceSchema,
    })
  ).min(0).max(12),
  interviewEvidenceSummary: z.string().min(5).max(800),
})

const comparisonBlockSchema = z.object({
  candidateA: z.string().min(1),
  candidateB: z.string().min(1),
  aStronger: z.array(z.string().min(5).max(400)).min(0).max(8),
  bStronger: z.array(z.string().min(5).max(400)).min(0).max(8),
  meaningfulTradeoffs: z.array(z.string().min(5).max(400)).min(0).max(8),
})

export const decisionBriefOutputSchema = z.object({
  executiveSummary: z.string().min(40).max(2000),
  candidates: z.array(candidateBriefSchema).min(1).max(4),
  crossCandidateComparison: z.array(comparisonBlockSchema).min(0).max(6),
  openQuestionsBeforeDecision: z.array(z.string().min(5).max(400)).min(0).max(10),
  missingEvidence: z.array(z.string().min(5).max(400)).min(0).max(10),
  recommendedNextSteps: z.array(z.string().min(5).max(400)).min(1).max(8),
})

export type DecisionBriefOutput = z.infer<typeof decisionBriefOutputSchema>
export type DecisionBriefCandidate = z.infer<typeof candidateBriefSchema>
export type DecisionBriefComparison = z.infer<typeof comparisonBlockSchema>
export type DecisionBriefEvidenceSource = z.infer<typeof evidenceSourceSchema>
