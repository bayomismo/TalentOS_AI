/**
 * TalentOS AI Engine.
 *
 * The single entry point for every AI feature in the product. The engine
 * is provider-agnostic — it talks only to `AIProvider`.
 *
 * Implemented in this codebase:
 *   - generateJobDescription()  (Sprint 5)
 *   - analyzeCV()               (Sprint 6)
 *   - rankCandidate()           (Sprint 6)
 *
 * Reserved for later sprints:
 *   - generateInterviewKit()
 *   - generateOfferLetter()
 *
 * Structured-output flow (per call):
 *   1. Render the prompt.
 *   2. Call provider.generateStructured(prompt, schema).
 *   3. Validate the parsed JSON with the Zod schema.
 *   4. On failure: retry once with a corrective system message.
 *   5. On second failure: throw `SchemaValidationError`.
 */

import type { ZodType } from 'zod'

import { getAIProvider } from '../providers/provider-factory'
import type { AIProvider } from '../providers/base-provider'
import { jobDescriptionPrompt } from '../prompts/job-description'
import { cvAnalysisPrompt, type CVAnalysisInput } from '../prompts/cv-analysis'
import { candidateRankingPrompt, type CandidateRankingInput } from '../prompts/candidate-ranking'
import { jobDescriptionOutputSchema } from '../schemas/job-description.schema'
import { cvAnalysisOutputSchema, type CVAnalysisOutput } from '../schemas/cv-analysis.schema'
import {
  candidateRankingOutputSchema,
  type CandidateRankingOutput,
} from '../schemas/candidate-ranking.schema'
import {
  AIEngineError,
  NotImplementedError,
  SchemaValidationError,
} from '../errors/ai-engine-error'
import type {
  JobDescriptionInput,
  ProviderHealth,
  ProviderResult,
} from '../types'
import type { JobDescriptionOutput } from '../schemas/job-description.schema'

export class AIEngine {
  private readonly provider: AIProvider

  constructor(provider?: AIProvider) {
    this.provider = provider ?? getAIProvider()
  }

  /** Exposes the underlying provider for advanced callers (e.g. health route). */
  getProvider(): AIProvider {
    return this.provider
  }

  // ---------------------------------------------------------------------------
  // Implemented
  // ---------------------------------------------------------------------------

  async generateJobDescription(
    input: JobDescriptionInput
  ): Promise<ProviderResult<JobDescriptionOutput>> {
    const prompt = jobDescriptionPrompt.render(input)
    const result = await this.callStructured<JobDescriptionOutput>(
      jobDescriptionPrompt.id,
      prompt,
      jobDescriptionOutputSchema
    )
    return result
  }

  /**
   * Sprint 6 — extracts a structured candidate profile from raw CV text.
   * The optional `jobContext` is folded into the prompt so the model can
   * recommend an appropriate next pipeline stage.
   */
  async analyzeCV(input: CVAnalysisInput): Promise<ProviderResult<CVAnalysisOutput>> {
    const prompt = cvAnalysisPrompt.render(input)
    return this.callStructured<CVAnalysisOutput>(
      cvAnalysisPrompt.id,
      prompt,
      cvAnalysisOutputSchema
    )
  }

  /**
   * Sprint 6 — scores a candidate against a job description.
   * Returns per-axis scores, an overall 0-100 score, a recommendation
   * label, and reasoning the HR team can read.
   */
  async rankCandidate(
    input: CandidateRankingInput
  ): Promise<ProviderResult<CandidateRankingOutput>> {
    const prompt = candidateRankingPrompt.render(input)
    return this.callStructured<CandidateRankingOutput>(
      candidateRankingPrompt.id,
      prompt,
      candidateRankingOutputSchema
    )
  }

  // ---------------------------------------------------------------------------
  // Not yet implemented — fail loudly so callers know to wait
  // ---------------------------------------------------------------------------

  generateInterviewKit(_input: {
    role: string
    level: string
    jobDescription: string
  }): Promise<never> {
    return Promise.reject(new NotImplementedError('generateInterviewKit'))
  }

  generateOfferLetter(_input: {
    candidateName: string
    role: string
    salary: string
    startDate: string
  }): Promise<never> {
    return Promise.reject(new NotImplementedError('generateOfferLetter'))
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  async health(): Promise<ProviderHealth> {
    return this.provider.healthCheck()
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Calls the provider with structured output, validates against the
   * Zod schema, and retries once on validation failure.
   */
  private async callStructured<T>(
    promptId: string,
    prompt: string,
    schema: ZodType<T>
  ): Promise<ProviderResult<T>> {
    let lastError: unknown = null
    const maxAttempts = 2

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.provider.generateStructured(prompt, schema)
        const parsed = schema.safeParse(result.data)
        if (parsed.success) {
          return {
            ...result,
            data: parsed.data,
          }
        }
        lastError = parsed.error
        if (attempt < maxAttempts) {
          continue
        }
      } catch (err) {
        if (err instanceof AIEngineError) throw err
        lastError = err
        if (attempt < maxAttempts) {
          continue
        }
        throw err
      }
    }

    throw new SchemaValidationError(promptId, serializeZodError(lastError))
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function serializeZodError(err: unknown): unknown {
  if (err && typeof err === 'object' && 'issues' in err) {
    return (err as { issues: unknown }).issues
  }
  return err
}

/** Re-export the prompt's Zod schema type for callers. */
export type { CVAnalysisOutput, CandidateRankingOutput }

/** Singleton for convenience — production code should pass a provider explicitly when DI matters. */
let defaultEngine: AIEngine | null = null

export function getAIEngine(): AIEngine {
  if (!defaultEngine) {
    defaultEngine = new AIEngine()
  }
  return defaultEngine
}

/** Convenience re-exports for ergonomic imports. */
export { jobDescriptionOutputSchema, cvAnalysisOutputSchema, candidateRankingOutputSchema, jobDescriptionPrompt, cvAnalysisPrompt, candidateRankingPrompt }
export type { JobDescriptionInput, CVAnalysisInput, CandidateRankingInput }
