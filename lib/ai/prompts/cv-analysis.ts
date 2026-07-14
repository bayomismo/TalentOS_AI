/**
 * CV Analysis prompt (placeholder).
 *
 * Reserved for the `analyzeCV` engine method. The render() body is
 * intentionally minimal so the file can compile in this sprint, but the
 * contract (id, version, schema description) is real.
 */

import type { PromptDefinition } from '../types'
import { cvAnalysisOutputSchema } from '../schemas/cv-analysis.schema'

const SCHEMA_DESCRIPTION = `{
  "candidateName": string,
  "currentTitle": string,
  "yearsExperience": number,
  "summary": string,
  "topSkills": string[],
  "strengths": string[],
  "concerns": string[],
  "recommendedStage": "APPLIED" | "SCREENING" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED"
}`

// Input shape will be defined in the sprint that implements analyzeCV().
// Using a permissive record here so the file can stand on its own.
export interface CVAnalysisInput {
  cvText: string
  jobContext?: string
}

export const cvAnalysisPrompt: PromptDefinition<CVAnalysisInput> = {
  id: 'cv-analysis.v1',
  name: 'CV Analysis',
  description: 'Extracts structured information from a candidate CV and recommends a stage.',
  version: {
    version: '0.1.0',
    authoredAt: '2026-07-14',
    changelog: 'Skeleton. Engine method throws NotImplementedError in this sprint.',
  },
  outputSchemaDescription: SCHEMA_DESCRIPTION,
  render(): string {
    // Will be implemented alongside the engine method in a later sprint.
    return 'CV analysis prompt — not yet implemented.'
  },
}

export { cvAnalysisOutputSchema }
