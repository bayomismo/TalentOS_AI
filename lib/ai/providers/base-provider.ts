/**
 * Abstract AI provider contract.
 *
 * Every provider (Gemini today, OpenAI/Anthropic/etc. tomorrow) implements
 * `AIProvider`. The engine only ever talks to this interface.
 *
 * Implementations must be:
 *  - Stateless: all state lives in the engine.
 *  - Deterministic where possible: same input + same temperature = same output.
 *  - Side-effect free: no DB writes, no logging to stdout.
 */

import type { ZodType } from 'zod'
import type {
  GenerateOptions,
  ProviderHealth,
  ProviderName,
  ProviderResult,
  TokenUsage,
} from '../types'

export interface AIProvider {
  /** Stable provider identifier (e.g. "gemini"). */
  readonly name: ProviderName

  /**
   * Returns the model identifier this provider is currently configured
   * with (e.g. "gemini-2.0-flash"). Used in logs and the health endpoint.
   */
  getModelName(): string

  /**
   * Returns true if the provider has everything it needs to make a call
   * (API key, base URL, etc.). Does NOT perform a network round trip.
   */
  isConfigured(): boolean

  /**
   * Liveness check. Performs a tiny, cheap call to the provider and
   * returns latency + status. Must never throw — encode failures in the
   * returned `ProviderHealth`.
   */
  healthCheck(): Promise<ProviderHealth>

  /**
   * Free-form text generation. Returns the raw provider output as a
   * string plus token usage. Used by the engine for prompts that don't
   * require strict JSON output.
   */
  generate(prompt: string, options?: GenerateOptions): Promise<ProviderResult<string>>

  /**
   * Structured generation. The provider is expected to:
   *   1. Call the model with a JSON-mode / responseSchema constraint.
   *   2. Return the raw JSON text.
   * The engine handles Zod validation and retry.
   */
  generateStructured(
    prompt: string,
    schema: ZodType,
    options?: GenerateOptions
  ): Promise<ProviderResult<unknown>>

  /**
   * Helper for engine internals — extract a normalized `TokenUsage` from
   * whatever shape the underlying SDK returns.
   */
  extractUsage(raw: unknown): TokenUsage
}
