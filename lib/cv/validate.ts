/**
 * CV upload validation.
 *
 * Rejects files that:
 *   - exceed the size limit
 *   - don't look like PDF or DOCX (signature, MIME, or extension)
 *   - are empty (zero bytes)
 */

import { CVUnsupportedTypeError, CVValidationError, type CVFileKind } from './errors'

export const MAX_CV_BYTES = 5 * 1024 * 1024 // 5 MB

const PDF_SIG = Buffer.from('%PDF-')
const DOCX_SIG = Buffer.from('PK\x03\x04') // ZIP magic

export interface ValidatedFile {
  buffer: Buffer
  fileName: string
  fileKind: CVFileKind
  mimeType: string
  size: number
}

/**
 * Validates a single file and returns a normalized `ValidatedFile`.
 *
 * Throws `CVUnsupportedTypeError` or `CVValidationError`. Never throws
 * on minor MIME mismatches if the signature clearly matches.
 */
export function validateAndClassify(input: {
  buffer: Buffer
  fileName: string
  mimeType?: string | null
}): ValidatedFile {
  const { buffer, fileName } = input
  const mimeType = input.mimeType ?? ''

  if (!buffer || buffer.length === 0) {
    throw new CVValidationError(`"${fileName}" is empty.`)
  }
  if (buffer.length > MAX_CV_BYTES) {
    throw new CVValidationError(
      `"${fileName}" is too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Max is 5 MB.`
    )
  }

  // Signature sniff first, then fall back to MIME / extension.
  if (buffer.subarray(0, PDF_SIG.length).equals(PDF_SIG)) {
    return { buffer, fileName, fileKind: 'PDF', mimeType: mimeType || 'application/pdf', size: buffer.length }
  }
  if (buffer.subarray(0, DOCX_SIG.length).equals(DOCX_SIG)) {
    return {
      buffer,
      fileName,
      fileKind: 'DOCX',
      mimeType: mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: buffer.length,
    }
  }

  // Last-resort: MIME or extension match.
  const lowerName = fileName.toLowerCase()
  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    throw new CVValidationError(`"${fileName}" doesn't look like a valid PDF (wrong file signature).`)
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.docx')
  ) {
    throw new CVValidationError(`"${fileName}" doesn't look like a valid DOCX (wrong file signature).`)
  }

  throw new CVUnsupportedTypeError(mimeType || lowerName.split('.').pop() || 'unknown')
}
