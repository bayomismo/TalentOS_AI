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
import {
  buildInterviewKitSystemPrompt,
  buildInterviewKitUserPrompt,
  type InterviewKitPromptInput,
} from '../prompts/interview-kit'
import { jobDescriptionOutputSchema } from '../schemas/job-description.schema'
import { cvAnalysisOutputSchema, type CVAnalysisOutput } from '../schemas/cv-analysis.schema'
import {
  candidateRankingOutputSchema,
  type CandidateRankingOutput,
} from '../schemas/candidate-ranking.schema'
import {
  interviewKitOutputSchema,
  type InterviewKitOutput,
} from '../schemas/interview-kit.schema'
import {
  buildDecisionBriefSystemPrompt,
  buildDecisionBriefUserPrompt,
  type DecisionBriefPromptInput,
} from '../prompts/decision-brief'
import {
  decisionBriefOutputSchema,
  type DecisionBriefOutput,
} from '../schemas/decision-brief.schema'
import {
  buildOfferLetterSystemPrompt,
  buildOfferLetterUserPrompt,
  offerLetterPrompt,
  type OfferLetterPromptFacts,
} from '../prompts/offer-letter'
import {
  offerLetterOutputSchema,
  type OfferLetterOutput,
} from '../schemas/offer-letter.schema'
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
  // Sprint 7 — personalized interview kit
  // ---------------------------------------------------------------------------

  /**
   * Sprint 7 — generates a fully personalized interview kit (overview,
   * candidate snapshot, opening/role-specific/skill-validation/gap-
   * validation/behavioral/scenario/candidate-specific/closing questions,
   * and a weighted scorecard). Pure AI generation. The application
   * computes the final interview score deterministically.
   */
  async generateInterviewKit(
    input: InterviewKitPromptInput
  ): Promise<ProviderResult<InterviewKitOutput>> {
    const userPrompt = buildInterviewKitUserPrompt(input)
    return this.callInterviewKit(userPrompt)
  }

  // ---------------------------------------------------------------------------
  // Sprint 10 — AI Offer Letter Drafting
  // ---------------------------------------------------------------------------

  /**
   * Generates a structured offer-letter draft from human-supplied facts.
   *
   * Hard guardrails (enforced by the prompt and verified by tests):
   *   - Uses ONLY the supplied facts. Compensation values are
   *     reproduced verbatim.
   *   - Does NOT mention CV score / interview score / AI recommendation
   *     / Decision Brief.
   *   - Does NOT introduce protected characteristics.
   *   - Does NOT promise employment guarantees.
   *
   * Implementation note: the offer-letter schema is shallow (10 string
   * fields + disclaimers) so the provider's `responseJsonSchema` /
   * `responseMimeType=application/json` + Zod parse + corrective-retry
   * pattern works without falling back to manual JSON parsing.
   */
  async generateOfferLetter(
    facts: OfferLetterPromptFacts
  ): Promise<ProviderResult<OfferLetterOutput>> {
    const systemPrompt = buildOfferLetterSystemPrompt()
    const userPrompt = buildOfferLetterUserPrompt(facts)
    return this.callOfferLetter(systemPrompt, userPrompt)
  }

  // ---------------------------------------------------------------------------
  // Sprint 8 — AI Decision Brief
  // ---------------------------------------------------------------------------

  /**
   * Generates a structured Decision Brief for a small set of finalists
   * (2-4 candidates). The brief is evidence-based, cites its sources,
   * and NEVER names a winner, a hire, or a rejection. The human user
   * owns the final call.
   *
   * Uses `provider.generate` + manual Zod parse (not responseJsonSchema)
   * for the same reason as the interview kit: Gemini rejects the
   * responseJsonSchema for deeply nested output.
   */
  async generateDecisionBrief(
    input: DecisionBriefPromptInput
  ): Promise<ProviderResult<DecisionBriefOutput>> {
    const userPrompt = buildDecisionBriefUserPrompt(input)
    return this.callDecisionBrief(userPrompt)
  }

  // ---------------------------------------------------------------------------
  // Sprint 10 — AI Offer Letter call helper
  // ---------------------------------------------------------------------------

  /**
   * Calls the provider with structured JSON output for the offer
   * letter, Zod-validates, and retries once with a corrective
   * message on failure. Mirrors callDecisionBrief because both
   * use application/json + manual parse.
   */
  private async callOfferLetter(
    systemPrompt: string,
    userPrompt: string
  ): Promise<ProviderResult<OfferLetterOutput>> {
    const fullPrompt = `${systemPrompt}\n\n# USER REQUEST\n${userPrompt}`

    const lastError: { value: unknown } = { value: null }
    const maxAttempts = 2

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const promptToUse =
        attempt === 1
          ? fullPrompt
          : `${fullPrompt}\n\n# CORRECTION (attempt ${attempt})\nYour previous response did not validate against the Zod schema. Re-emit a complete JSON object that matches the contract above. Do not include any commentary.`

      try {
        const result = await this.provider.generate(promptToUse, {
          responseMimeType: 'application/json',
          temperature: 0.3,
        })
        let rawText = (result.data as string).trim()
        rawText = rawText
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim()
        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(rawText)
        } catch (jsonErr) {
          lastError.value = jsonErr
          continue
        }
        const parsed = offerLetterOutputSchema.safeParse(parsedJson)
        if (parsed.success) {
          return { ...result, data: parsed.data }
        }
        lastError.value = parsed.error
      } catch (err) {
        if (err instanceof AIEngineError) throw err
        lastError.value = err
      }
    }

    throw new SchemaValidationError(
      offerLetterPrompt.id,
      serializeZodError(lastError.value),
    )
  }


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

  /**
   * The interview-kit prompt is system + user. We inject a system prompt
   * for the role + safety + output contract, and a user prompt with the
   * full denormalized job + candidate + match context.
   *
   * The provider's `generateStructured` is called with a Zod schema for
   * structural validation. On validation failure, we retry once with a
   * corrective system message.
   */
  private async callInterviewKit(
    userPrompt: string
  ): Promise<ProviderResult<InterviewKitOutput>> {
    const systemPrompt = buildInterviewKitSystemPrompt()
    const fullPrompt = `${systemPrompt}\n\n# USER REQUEST\n${userPrompt}`

    const lastError: { value: unknown } = { value: null }
    const maxAttempts = 2

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const promptToUse =
        attempt === 1
          ? fullPrompt
          : `${fullPrompt}\n\n# CORRECTION (attempt ${attempt})\nYour previous response did not validate against the Zod schema. Re-emit a complete JSON object that matches the contract above. Do not include any commentary.`

      try {
        // We use `generate` (not `generateStructured`) for the interview
        // kit because Gemini's responseJsonSchema rejects deeply nested
        // objects. We force application/json and parse + Zod-validate the
        // text manually. On validation failure, the next loop iteration
        // injects a corrective system message.
        const result = await this.provider.generate(promptToUse, {
          responseMimeType: 'application/json',
          temperature: 0.4,
        })
        let rawText = (result.data as string).trim()
        // Strip a single leading/trailing markdown fence if the model
        // emitted one despite the instructions.
        rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(rawText)
        } catch (jsonErr) {
          lastError.value = jsonErr
          continue
        }
        const parsed = interviewKitOutputSchema.safeParse(parsedJson)
        if (parsed.success) {
          return { ...result, data: parsed.data }
        }
        lastError.value = parsed.error
      } catch (err) {
        if (err instanceof AIEngineError) throw err
        lastError.value = err
      }
    }

    throw new SchemaValidationError('interview-kit', serializeZodError(lastError.value))
  }

  /**
   * Like callInterviewKit, but for the Decision Brief. Same
   * application/json + Zod-validate + corrective-retry pattern.
   */
  private async callDecisionBrief(
    userPrompt: string
  ): Promise<ProviderResult<DecisionBriefOutput>> {
    const systemPrompt = buildDecisionBriefSystemPrompt()
    const fullPrompt = `${systemPrompt}\n\n# USER REQUEST\n${userPrompt}`

    const lastError: { value: unknown } = { value: null }
    const maxAttempts = 2

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const promptToUse =
        attempt === 1
          ? fullPrompt
          : `${fullPrompt}\n\n# CORRECTION (attempt ${attempt})\nYour previous response did not validate against the Zod schema. Re-emit a complete JSON object that matches the contract above. Do not include any commentary.`

      try {
        const result = await this.provider.generate(promptToUse, {
          responseMimeType: 'application/json',
          temperature: 0.3,
        })
        let rawText = (result.data as string).trim()
        rawText = rawText
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim()
        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(rawText)
        } catch (jsonErr) {
          lastError.value = jsonErr
          continue
        }
        const parsed = decisionBriefOutputSchema.safeParse(parsedJson)
        if (parsed.success) {
          return { ...result, data: parsed.data }
        }
        lastError.value = parsed.error
      } catch (err) {
        if (err instanceof AIEngineError) throw err
        lastError.value = err
      }
    }

    throw new SchemaValidationError('decision-brief', serializeZodError(lastError.value))
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
