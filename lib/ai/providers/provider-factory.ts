/**
 * AI provider factory.
 *
 * Resolves the active provider based on environment configuration. Today
 * only `gemini` is implemented. Tomorrow, the switch here is the single
 * place to plug in OpenAI / Anthropic / etc.
 *
 * The factory also caches instances so a long-lived server process doesn't
 * pay the cost of re-constructing clients on every call.
 */

import { GeminiProvider } from './gemini-provider'
import type { AIProvider } from './base-provider'
import type { ProviderName } from '../types'

interface ProviderOptions {
  apiKey?: string
  model?: string
}

let cached: AIProvider | null = null
let cachedName: ProviderName | null = null

/**
 * Returns the active provider. The default is `gemini`. Override with the
 * `AI_PROVIDER` env var (e.g. "gemini").
 */
export function getAIProvider(
  name: ProviderName = (process.env.AI_PROVIDER as ProviderName) || 'gemini',
  options: ProviderOptions = {}
): AIProvider {
  if (cached && cachedName === name && !options.apiKey && !options.model) {
    return cached
  }

  let provider: AIProvider
  switch (name) {
    case 'gemini':
      provider = new GeminiProvider(options)
      break
    default:
      throw new Error(`Unknown AI provider: ${name}`)
  }

  if (!options.apiKey && !options.model) {
    cached = provider
    cachedName = name
  }
  return provider
}

/** Test-only — clears the cached instance. */
export function _resetProviderCache(): void {
  cached = null
  cachedName = null
}
