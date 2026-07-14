/**
 * Interview Kit prompt (placeholder).
 *
 * Reserved for the `generateInterviewKit` engine method.
 */

import type { PromptDefinition } from '../types'
import { interviewKitOutputSchema } from '../schemas/interview-kit.schema'

const SCHEMA_DESCRIPTION = `{
  "role": string,
  "totalDurationMinutes": number,
  "categories": [
    {
      "name": string,
      "durationMinutes": number,
      "questions": [
        { "question": string, "difficulty": "EASY" | "MEDIUM" | "HARD" | "EXPERT", "expectedAnswer"?: string }
      ]
    }
  ]
}`

export interface InterviewKitInput {
  role: string
  level: string
  jobDescription: string
  durationMinutes?: number
}

export const interviewKitPrompt: PromptDefinition<InterviewKitInput> = {
  id: 'interview-kit.v1',
  name: 'Interview Kit',
  description: 'Builds a structured multi-round interview plan for a given role.',
  version: {
    version: '0.1.0',
    authoredAt: '2026-07-14',
    changelog: 'Skeleton. Engine method throws NotImplementedError in this sprint.',
  },
  outputSchemaDescription: SCHEMA_DESCRIPTION,
  render(): string {
    return 'Interview kit prompt — not yet implemented.'
  },
}

export { interviewKitOutputSchema }
