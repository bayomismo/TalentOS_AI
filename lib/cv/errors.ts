/**
 * CV-related errors.
 *
 * Every error raised by the CV pipeline extends `CVError` so callers
 * (server actions, UI) can do a single `instanceof` check and convert
 * the error into a user-facing message.
 */

export type CVFileKind = 'PDF' | 'DOCX'

export class CVError extends Error {
  public readonly code: string
  public readonly retryable: boolean
  public readonly cause?: unknown

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {}
  ) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.retryable = options.retryable ?? false
    this.cause = options.cause
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, retryable: this.retryable }
  }
}

export class CVValidationError extends CVError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super('CV_VALIDATION_ERROR', message, { retryable: false, cause: options.cause })
  }
}

export class CVParseError extends CVError {
  public readonly fileKind: CVFileKind

  constructor(fileKind: CVFileKind, message: string, options: { cause?: unknown } = {}) {
    super('CV_PARSE_ERROR', message, { retryable: false, cause: options.cause })
    this.fileKind = fileKind
  }
}

export class CVUnsupportedTypeError extends CVError {
  public readonly detected: string

  constructor(detected: string) {
    super('CV_UNSUPPORTED_TYPE', `Unsupported file type: ${detected}. Please upload a PDF or DOCX.`)
    this.detected = detected
  }
}
