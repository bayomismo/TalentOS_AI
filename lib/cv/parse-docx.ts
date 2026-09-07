/**
 * DOCX text extraction.
 *
 * Uses `mammoth` (no native deps). Extracts the raw text of the
 * document — formatting, images, and tables are flattened.
 *
 * Throws `CVParseError` for any parser failure.
 */

import { CVParseError } from './errors'

export async function parseDocx(buffer: Buffer): Promise<string> {
  let mammoth: { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string; messages: unknown[] }> }
  try {
    mammoth = (await import('mammoth')).default ?? (await import('mammoth'))
  } catch (err) {
    throw new CVParseError('DOCX', 'Failed to load the DOCX parser.', { cause: err })
  }

  let result: { value: string; messages: unknown[] }
  try {
    result = await mammoth.extractRawText({ buffer })
  } catch (err) {
    throw new CVParseError('DOCX', 'The DOCX file appears to be corrupted.', { cause: err })
  }

  const text = (result.value ?? '').trim()
  if (text.length < 20) {
    throw new CVParseError('DOCX', 'The DOCX contains no extractable text.')
  }
  return text
}
