/**
 * Offer Letter prompt (placeholder).
 *
 * Reserved for the `generateOfferLetter` engine method. No engine method
 * is implemented in this sprint (it was not in the explicit list of
 * methods to implement), but the file lives in `prompts/` so the
 * directory is complete and the contract is documented.
 */

const SCHEMA_DESCRIPTION = `{
  "title": string,
  "greeting": string,
  "body": string,
  "compensation": string,
  "startDate": string,
  "expirationDate": string,
  "signature": string
}`

export interface OfferLetterInput {
  candidateName: string
  role: string
  salary: string
  startDate: string
  companyName: string
  extraContext?: string
}

export const offerLetterPrompt = {
  id: 'offer-letter.v1',
  name: 'Offer Letter',
  description: 'Drafts a warm, professional offer letter for a candidate.',
  version: {
    version: '0.1.0',
    authoredAt: '2026-07-14',
    changelog: 'Skeleton. Engine method pending in a later sprint.',
  },
  outputSchemaDescription: SCHEMA_DESCRIPTION,
  render(_input: OfferLetterInput): string {
    return 'Offer letter prompt — not yet implemented.'
  },
} as const
