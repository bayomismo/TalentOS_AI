/**
 * Candidate Ranking — structured output schema.
 *
 * Used by `AIEngine.rankCandidate()`. Compares a candidate profile to a
 * job description and returns a per-axis score breakdown, an overall
 * 0-100 score, a user-facing recommendation label, and reasoning that
 * an HR user can read.
 *
 * Fairness is enforced at the prompt level (see prompts/candidate-ranking.ts).
 */

import { z } from 'zod'

export const candidateRecommendation = z.enum([
  'STRONG_MATCH',
  'GOOD_MATCH',
  'POTENTIAL_MATCH',
  'WEAK_MATCH',
  'NOT_RECOMMENDED',
])
export type CandidateRecommendation = z.infer<typeof candidateRecommendation>

export const candidateRankingOutputSchema = z.object({
  candidateId: z.string().min(1),
  hiringRequestId: z.string().min(1),
  overallScore: z.number().int().min(0).max(100),
  skillsScore: z.number().int().min(0).max(100),
  experienceScore: z.number().int().min(0).max(100),
  educationScore: z.number().int().min(0).max(100),
  roleScore: z.number().int().min(0).max(100),
  recommendation: candidateRecommendation,
  /** Concise explanation a recruiter can read. Plain text, no markdown. */
  reasoning: z.string().min(40).max(1200),
  strengths: z.array(z.string().min(1).max(200)).min(1).max(8),
  gaps: z.array(z.string().min(1).max(200)).max(8).default([]),
  concerns: z.array(z.string().min(1).max(200)).max(6).default([]),
})

export type CandidateRankingOutput = z.infer<typeof candidateRankingOutputSchema>

/**
 * Map a recommendation enum to a user-facing label.
 */
export function recommendationToLabel(r: CandidateRecommendation): string {
  switch (r) {
    case 'STRONG_MATCH':
      return 'Strong Match'
    case 'GOOD_MATCH':
      return 'Good Match'
    case 'POTENTIAL_MATCH':
      return 'Potential Match'
    case 'WEAK_MATCH':
      return 'Weak Match'
    case 'NOT_RECOMMENDED':
      return 'Not Recommended'
  }
}
