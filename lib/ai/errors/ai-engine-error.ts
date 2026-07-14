/**
 * Typed errors raised by the AI Engine.
 *
 * Every error in the engine extends `AIEngineError` so callers can do a
 * single `instanceof` check. Each subclass carries structured fields that
 * are safe to surface to API consumers (no internal stack traces).
 */

/** Base class for every error raised by the AI engine. */
export class AIEngineError extends Error {
  public readonly code: string
  public readonly provider?: string
  public readonly retryable: boolean
  public readonly cause?: unknown

  constructor(
    code: string,
    message: string,
    options: {
      provider?: string
      retryable?: boolean
      cause?: unknown
    } = {}
  ) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.provider = options.provider
    this.retryable = options.retryable ?? false
    this.cause = options.cause

    // Preserve the prototype chain when targeting older runtimes.
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /** Serializes the error to a plain object safe to ship to a client. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      provider: this.provider,
      retryable: this.retryable,
    }
  }
}

/** The provider is not configured (e.g. missing API key). */
export class ProviderNotConfiguredError extends AIEngineError {
  constructor(provider: string, missing: string) {
    super(
      'PROVIDER_NOT_CONFIGURED',
      `Provider "${provider}" is not configured: missing ${missing}.`,
      { provider, retryable: false }
    )
  }
}

/** The provider returned data that did not match the Zod schema. */
export class SchemaValidationError extends AIEngineError {
  public readonly issues: unknown

  constructor(promptId: string, issues: unknown, cause?: unknown) {
    super(
      'SCHEMA_VALIDATION_FAILED',
      `Structured output for "${promptId}" did not match the expected schema after retrying.`,
      { retryable: false, cause }
    )
    this.issues = issues
  }
}

/** The requested method is recognized but not yet implemented. */
export class NotImplementedError extends AIEngineError {
  constructor(method: string) {
    super(
      'NOT_IMPLEMENTED',
      `AI engine method "${method}" is not implemented yet.`,
      { retryable: false }
    )
  }
}
