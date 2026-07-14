/**
 * Candidate Ranking prompt (placeholder).
 *
 * Reserved for the `rankCandidate` engine method.
 */

import type { PromptDefinition } from '../types'
import { candidateRankingOutputSchema } from '../schemas/candidate-ranking.schema'

const SCHEMA_DESCRIPTION = `{
  "candidateId": string,
  "hiringRequestId": string,
  "score": number (0-100),
  "recommendation": "STRONG_HIRE" | "HIRE" | "NO_HIRE" | "STRONG_NO_HIRE",
  "reasoning": string,
  "matchedCriteria": string[],
  "gaps": string[]
}`

export interface CandidateRankingInput {
  candidateId: string
  hiringRequestId: string
  jobDescription: string
  candidateProfile: string
}

export const candidateRankingPrompt: PromptDefinition<CandidateRankingInput> = {
  id: 'candidate-ranking.v1',
  name: 'Candidate Ranking',
  description: 'Scores a candidate against a job description and returns a recommendation.',
  version: {
    version: '0.1.0',
    authoredAt: '2026-07-14',
    changelog: 'Skeleton. Engine method throws NotImplementedError in this sprint.',
  },
  outputSchemaDescription: SCHEMA_DESCRIPTION,
  render(): string {
    return 'Candidate ranking prompt — not yet implemented.'
  },
}

export { candidateRankingOutputSchema }
