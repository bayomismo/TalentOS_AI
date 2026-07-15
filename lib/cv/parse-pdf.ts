/**
 * PDF text extraction.
 *
 * Uses `pdf-parse` 1.1.1 — a small, pure-Node.js PDF parser. Unlike
 * `pdf-parse@2.x` (which wraps pdfjs-dist and needs browser APIs like
 * `DOMMatrix`), 1.x works fine in Vercel's Node.js serverless runtime.
 *
 * Throws `CVParseError` for any parser failure; the caller converts
 * that to a user-facing message.
 */

import { CVParseError } from './errors'

interface PdfParseResult {
  numpages: number
  numrender: number
  info: unknown
  metadata: unknown
  text: string
  version: string
}

let _parser: ((data: Buffer) => Promise<PdfParseResult>) | null = null

function loadParser(): (data: Buffer) => Promise<PdfParseResult> {
  if (_parser) return _parser
  // pdf-parse 1.x is CJS. It has a `lib/pdf-parse.js` entry that doesn't
  // run the test PDF that ships in the `index.js` root.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const mod = require('pdf-parse/lib/pdf-parse.js')
  _parser = (mod.default ?? mod) as (data: Buffer) => Promise<PdfParseResult>
  return _parser
}

export async function parsePdf(buffer: Buffer): Promise<string> {
  let parse: (data: Buffer) => Promise<PdfParseResult>
  try {
    parse = loadParser()
  } catch (err) {
    throw new CVParseError('PDF', 'Failed to load the PDF parser.', { cause: err })
  }

  let result: PdfParseResult
  try {
    result = await parse(buffer)
  } catch (err) {
    throw new CVParseError('PDF', 'The PDF appears to be corrupted or password-protected.', { cause: err })
  }

  const text = (result.text ?? '').trim()
  if (text.length < 20) {
    throw new CVParseError('PDF', 'The PDF contains no extractable text (it may be a scanned image).')
  }
  return text
}
