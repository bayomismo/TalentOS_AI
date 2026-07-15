/**
 * Sprint 10 — Zod schema for the AI Offer Letter output.
 *
 * PART 9: the offer letter is a structured document with editable
 * sections. Every section is a plain string so the UI can render
 * it in a textarea and persist the user's edits.
 *
 * Validation is deliberately strict on type (every field required,
 * strings only) but lenient on length and content so the model has
 * room to produce professional prose.
 */

import { z } from 'zod'

const Section = z.string().min(1).max(8000)

export const offerLetterOutputSchema = z.object({
  title: Section,
  opening: Section,
  roleSummary: Section,
  compensationSection: Section,
  benefitsSection: Section,
  employmentTermsSection: Section,
  startDateSection: Section,
  acceptanceInstructions: Section,
  closing: Section,
  disclaimers: z.array(z.string().min(1).max(1000)).min(0).max(20),
})

export type OfferLetterOutput = z.infer<typeof offerLetterOutputSchema>
