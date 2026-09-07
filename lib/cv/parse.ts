/**
 * CV parsing — public dispatch.
 *
 * `parseCV(buffer, fileName, mimeType)` does the full pipeline:
 *   1. validateAndClassify
 *   2. extract text (PDF or DOCX)
 *   3. return `{ text, fileKind, fileName, mimeType, size }`
 */

import { parseDocx } from './parse-docx'
import { parsePdf } from './parse-pdf'
import { validateAndClassify, MAX_CV_BYTES, type ValidatedFile } from './validate'

export interface ParsedCV extends ValidatedFile {
  text: string
}

export async function parseCV(input: {
  buffer: Buffer
  fileName: string
  mimeType?: string | null
}): Promise<ParsedCV> {
  const validated = validateAndClassify(input)
  const text =
    validated.fileKind === 'PDF' ? await parsePdf(validated.buffer) : await parseDocx(validated.buffer)
  return { ...validated, text }
}

export { validateAndClassify, MAX_CV_BYTES }
export * from './errors'
export type { ValidatedFile }
