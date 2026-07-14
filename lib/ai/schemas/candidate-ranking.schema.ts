/**
 * Candidate Ranking — structured output schema (placeholder).
 *
 * Used by the future `rankCandidate` engine method. Returns the model
 * verdict and the reasoning that led to it so the UI can show both the
 * score and the "why".
 */

import { z } from 'zod'

export const candidateRankingOutputSchema = z.object({
  candidateId: z.string().min(1),
  hiringRequestId: z.string().min(1),
  score: z.number().int().min(0).max(100),
  recommendation: z.enum(['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE']),
  reasoning: z.string().min(20),
  matchedCriteria: z.array(z.string().min(1)).max(20).default([]),
  gaps: z.array(z.string().min(1)).max(20).default([]),
})

export type CandidateRankingOutput = z.infer<typeof candidateRankingOutputSchema>
