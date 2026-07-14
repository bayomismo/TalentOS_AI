/**
 * TalentOS AI Engine — shared types.
 *
 * Everything in the AI layer is provider-agnostic. The types in this file
 * are the contract between the engine, the providers, and the consumers.
 *
 * No provider-specific imports allowed here.
 */

// -----------------------------------------------------------------------------
// Provider metadata
// -----------------------------------------------------------------------------

export type ProviderName = 'gemini'

export type ProviderHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'unconfigured'

export interface ProviderHealth {
  provider: ProviderName
  model: string
  status: ProviderHealthStatus
  latencyMs: number | null
  error?: string
  checkedAt: string // ISO timestamp
}

// -----------------------------------------------------------------------------
// Generation
// -----------------------------------------------------------------------------

/**
 * Common options for every generation call. All fields are optional so
 * callers can tune behavior without touching the engine internals.
 */
export interface GenerateOptions {
  /** Sampling temperature. 0 = deterministic, 1 = creative. */
  temperature?: number
  /** Nucleus sampling cutoff. */
  topP?: number
  /** Max output tokens. Provider-specific mapping. */
  maxOutputTokens?: number
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
  /** Free-form provider-specific overrides. */
  metadata?: Record<string, string>
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface ProviderResult<T> {
  /** The validated, typed payload returned to the caller. */
  data: T
  /** Raw text the provider returned (useful for debugging). */
  raw: string
  /** Token usage, when the provider reports it. */
  usage: TokenUsage
  /** Latency in ms for this specific call. */
  latencyMs: number
  /** Which provider + model produced this result. */
  provider: ProviderName
  model: string
}

// -----------------------------------------------------------------------------
// Job description inputs
// -----------------------------------------------------------------------------

export type EmploymentType =
  | 'FULL_TIME'
  | 'PART_TIME'
  | 'CONTRACT'
  | 'INTERNSHIP'
  | 'TEMPORARY'

export interface JobDescriptionInput {
  role: string
  department: string
  employmentType: EmploymentType
  experience: string // e.g. "5+ years", "Senior", "Entry level"
  location: string
  companySummary: string
  /** Optional extra context the engine will fold into the prompt. */
  extraContext?: string
}

// -----------------------------------------------------------------------------
// Prompt metadata
// -----------------------------------------------------------------------------

export interface PromptVersion {
  version: string
  /** ISO date this version was authored. */
  authoredAt: string
  /** Human-readable changelog. */
  changelog: string
}

export interface PromptDefinition<Input> {
  /** Stable identifier used in logs and A/B tests. */
  id: string
  /** Display name for the prompt library UI. */
  name: string
  /** Short description of what this prompt produces. */
  description: string
  /** Current version metadata. */
  version: PromptVersion
  /**
   * Renders the prompt body for a given input. The provider is expected to
   * pass the result straight to the model as either a `user` turn (for
   * single-turn prompts) or as the seed for a conversation.
   */
  render: (input: Input) => string
  /**
   * Returns the JSON Schema description for this prompt's expected output.
   * The provider uses this to constrain structured output when supported.
   */
  outputSchemaDescription: string
}
