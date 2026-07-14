/**
 * CV Analysis — structured output schema (placeholder).
 *
 * This sprint defines the contract but does not implement the engine
 * method. Keep the schema small and pragmatic so callers can rely on it
 * once Sprint 5+ wires it up.
 */

import { z } from 'zod'

export const cvAnalysisOutputSchema = z.object({
  candidateName: z.string().min(1),
  currentTitle: z.string().min(1),
  yearsExperience: z.number().int().nonnegative(),
  summary: z.string().min(20),
  topSkills: z.array(z.string().min(1)).min(1).max(20),
  strengths: z.array(z.string().min(1)).max(10).default([]),
  concerns: z.array(z.string().min(1)).max(10).default([]),
  recommendedStage: z.enum([
    'APPLIED',
    'SCREENING',
    'INTERVIEW',
    'OFFER',
    'HIRED',
    'REJECTED',
  ]),
})

export type CVAnalysisOutput = z.infer<typeof cvAnalysisOutputSchema>
