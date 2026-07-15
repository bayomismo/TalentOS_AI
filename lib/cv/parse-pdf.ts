/**
 * PDF text extraction.
 *
 * Uses `pdf-parse` 2.x (ESM/CJS dual build). The 2.x API is class-based:
 *   new PDFParse({ data }).getText()
 *
 * Throws `CVParseError` for any error the parser reports; the caller
 * converts that to a user-facing message.
 */

import { CVParseError } from './errors'

export async function parsePdf(buffer: Buffer): Promise<string> {
  let PDFParse: new (opts: { data: Uint8Array }) => {
    getText: () => Promise<{ text: string; numpages: number }>
    destroy: () => Promise<void>
  }
  try {
    const mod: any = await import('pdf-parse')
    PDFParse = mod.PDFParse ?? mod.default?.PDFParse
    if (!PDFParse) {
      throw new Error('PDFParse class not exported by pdf-parse')
    }
  } catch (err) {
    throw new CVParseError('PDF', 'Failed to load the PDF parser.', { cause: err })
  }

  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  let result: { text: string; numpages: number }
  try {
    result = await parser.getText()
  } catch (err) {
    try {
      await parser.destroy()
    } catch {
      // ignore
    }
    throw new CVParseError('PDF', 'The PDF appears to be corrupted or password-protected.', { cause: err })
  }

  try {
    await parser.destroy()
  } catch {
    // ignore cleanup failures
  }

  const text = (result.text ?? '').trim()
  if (text.length < 20) {
    throw new CVParseError('PDF', 'The PDF contains no extractable text (it may be a scanned image).')
  }
  return text
}
