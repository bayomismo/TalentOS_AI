/**
 * Google Gemini AI provider.
 *
 * Implements the `AIProvider` contract using the official `@google/genai`
 * SDK. Only this provider is implemented today; the rest of the engine
 * is provider-agnostic.
 *
 * Configuration is read from environment variables:
 *   - GEMINI_API_KEY  (required) — the Google AI Studio / Vertex AI key
 *   - GEMINI_MODEL    (optional) — model id, defaults to "gemini-2.0-flash"
 *
 * The provider never logs secrets. It does surface a typed error when the
 * key is missing, so the engine can degrade gracefully.
 */

import { GoogleGenAI, type GenerationConfig, type GenerateContentResponse } from '@google/genai'
import { toJSONSchema, type ZodType } from 'zod'

import type { AIProvider } from './base-provider'
import type {
  GenerateOptions,
  ProviderHealth,
  ProviderName,
  ProviderResult,
  TokenUsage,
} from '../types'
import {
  AIEngineError,
  ProviderNotConfiguredError,
} from '../errors/ai-engine-error'

const DEFAULT_MODEL = 'gemini-2.0-flash'

function resolveModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL
}

function readApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY
  if (!key || key.trim() === '') return null
  return key
}

export class GeminiProvider implements AIProvider {
  public readonly name: ProviderName = 'gemini'
  private readonly client: GoogleGenAI | null
  private readonly model: string

  constructor(options: { apiKey?: string; model?: string } = {}) {
    const apiKey = options.apiKey ?? readApiKey()
    this.model = options.model ?? resolveModel()

    if (!apiKey) {
      this.client = null
    } else {
      this.client = new GoogleGenAI({ apiKey })
    }
  }

  getModelName(): string {
    return this.model
  }

  isConfigured(): boolean {
    return this.client !== null
  }

  private ensureClient(): GoogleGenAI {
    if (!this.client) {
      throw new ProviderNotConfiguredError('gemini', 'GEMINI_API_KEY')
    }
    return this.client
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString()

    if (!this.isConfigured()) {
      return {
        provider: this.name,
        model: this.model,
        status: 'unconfigured',
        latencyMs: null,
        error: 'GEMINI_API_KEY is not set',
        checkedAt,
      }
    }

    const started = Date.now()
    try {
      const client = this.ensureClient()
      // A tiny call (1 token of output) is the cheapest possible liveness probe.
      const response = await client.models.generateContent({
        model: this.model,
        contents: 'ping',
        config: { maxOutputTokens: 1, temperature: 0 },
      })
      const latencyMs = Date.now() - started
      const text = response.text ?? ''
      if (!text && !response.candidates) {
        return {
          provider: this.name,
          model: this.model,
          status: 'unhealthy',
          latencyMs,
          error: 'Empty response from Gemini',
          checkedAt,
        }
      }
      return {
        provider: this.name,
        model: this.model,
        status: 'healthy',
        latencyMs,
        checkedAt,
      }
    } catch (err) {
      const latencyMs = Date.now() - started
      return {
        provider: this.name,
        model: this.model,
        status: 'unhealthy',
        latencyMs,
        error: errorMessage(err),
        checkedAt,
      }
    }
  }

  async generate(
    prompt: string,
    options: GenerateOptions = {}
  ): Promise<ProviderResult<string>> {
    const client = this.ensureClient()
    const config = this.buildGenerationConfig(options)

    const started = Date.now()
    try {
      const response = await client.models.generateContent({
        model: this.model,
        contents: prompt,
        config,
      })
      const latencyMs = Date.now() - started
      const text = response.text ?? ''
      const usage = this.extractUsage(response)

      return {
        data: text,
        raw: text,
        usage,
        latencyMs,
        provider: this.name,
        model: this.model,
      }
    } catch (err) {
      throw new AIEngineError('PROVIDER_REQUEST_FAILED', errorMessage(err), {
        provider: this.name,
        cause: err,
      })
    }
  }

  async generateStructured(
    prompt: string,
    schema: ZodType,
    options: GenerateOptions = {}
  ): Promise<ProviderResult<unknown>> {
    const client = this.ensureClient()
    const config = this.buildGenerationConfig(options, schema)

    const started = Date.now()
    try {
      const response = await client.models.generateContent({
        model: this.model,
        contents: prompt,
        config,
      })
      const latencyMs = Date.now() - started
      const text = response.text ?? ''
      const usage = this.extractUsage(response)

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (err) {
        throw new AIEngineError(
          'PROVIDER_INVALID_JSON',
          'Provider returned text that is not valid JSON.',
          { provider: this.name, cause: err }
        )
      }

      return {
        data: parsed,
        raw: text,
        usage,
        latencyMs,
        provider: this.name,
        model: this.model,
      }
    } catch (err) {
      if (err instanceof AIEngineError) throw err
      throw new AIEngineError('PROVIDER_REQUEST_FAILED', errorMessage(err), {
        provider: this.name,
        cause: err,
      })
    }
  }

  extractUsage(raw: unknown): TokenUsage {
    const response = raw as Partial<GenerateContentResponse> | undefined
    const meta = response?.usageMetadata
    const inputTokens = meta?.promptTokenCount ?? 0
    const outputTokens = meta?.candidatesTokenCount ?? 0
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private buildGenerationConfig(
    options: GenerateOptions,
    schema?: ZodType
  ): GenerationConfig {
    const config: GenerationConfig = {}
    if (options.temperature !== undefined) config.temperature = options.temperature
    if (options.topP !== undefined) config.topP = options.topP
    if (options.maxOutputTokens !== undefined) {
      config.maxOutputTokens = options.maxOutputTokens
    }
    if (schema) {
      // Constrain output to JSON. We also pass a Zod-derived schema when the
      // provider supports responseSchema; for Gemini, the simplest portable
      // approach is responseMimeType = application/json + responseJsonSchema.
      config.responseMimeType = 'application/json'
      try {
        // zod-to-json-schema conversion. Available in zod 3.23+ / zod 4.
        const jsonSchema = toJSONSchema(schema)
        // Gemini's responseJsonSchema expects a subset of JSON Schema.
        // Strip fields that Gemini rejects (e.g. $schema, additionalProperties).
        config.responseJsonSchema = sanitizeJsonSchema(jsonSchema)
      } catch {
        // If we can't derive a schema, fall back to plain JSON.
      }
    } else {
      config.responseMimeType = 'text/plain'
    }
    return config
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return 'Unknown error'
  }
}

/**
 * Removes JSON-Schema fields the Gemini responseJsonSchema does not
 * accept (e.g. `$schema`, `additionalProperties`, `default`). Keeps the
 * call safe even when the Zod schema uses defaults.
 */
function sanitizeJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeJsonSchema)
  }
  if (schema && typeof schema === 'object') {
    const obj = schema as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (key === '$schema' || key === 'additionalProperties' || key === 'default') {
        continue
      }
      out[key] = sanitizeJsonSchema(value)
    }
    return out
  }
  return schema
}
