/**
 * Sprint 10 — Offer Letter prompt (system + user).
 *
 * PART 7-11 guardrails:
 *   - Use only the facts supplied by the human. Do not invent or change
 *     compensation values.
 *   - Do not introduce protected characteristics.
 *   - Do not mention CV / interview / AI recommendation / Decision Brief.
 *   - Do not promise employment guarantees or jurisdiction-specific
 *     legal clauses beyond what the employer supplied.
 *   - Output a JSON object matching `offerLetterOutputSchema`.
 *
 * The prompt intentionally uses two builders (system + user) so the
 * guardrails live in the system block (high in the model's attention)
 * and the data lives in the user block (the "facts" the model may use).
 */

import type { OfferLetterOutput } from '../schemas/offer-letter.schema'

/**
 * Facts the human supplied. Compensation values are passed as plain
 * numbers + currency + period so the model cannot misread them.
 */
export interface OfferLetterPromptFacts {
  candidateName: string
  jobTitle: string
  department: string
  employmentType: string | null
  workArrangement: string | null
  startDate: string | null // ISO 8601
  expiryDate: string | null
  companyName: string
  hiringManagerName: string | null

  // Human-supplied compensation (the model may format but may not change)
  baseSalaryAmount: number
  baseSalaryCurrency: string
  baseSalaryPeriod: string // annual | monthly | hourly
  bonusAmount: number | null
  equityAmount: string | null
  commissionAmount: number | null
  vacationDays: number | null

  // Human-supplied free-form
  benefits: string | null
  additionalTerms: string | null
  probationPeriodDays: number | null
  noticePeriodDays: number | null
}

const PROMPT_VERSION = '1.0.0'
const PROMPT_ID = 'offer-letter.v1'
const PROMPT_NAME = 'Offer Letter Drafter'

/**
 * Returns the system prompt. Contains the role, the contract, and the
 * guardrails. This block is identical for every request.
 */
export function buildOfferLetterSystemPrompt(): string {
  return `# ROLE

You are an HR copywriter at "${PROMPT_NAME}". Your job is to convert the
fact-set supplied by the human recruiter into professional, neutral
offer-letter prose. You are a FORMATTER, not a decision-maker.

# CONTRACT

Emit a single JSON object that matches the schema below. Do not wrap it
in markdown fences. Do not emit any text before or after the JSON.

{
  "title": string,
  "opening": string,
  "roleSummary": string,
  "compensationSection": string,
  "benefitsSection": string,
  "employmentTermsSection": string,
  "startDateSection": string,
  "acceptanceInstructions": string,
  "closing": string,
  "disclaimers": string[]
}

# HARD GUARDRAILS

1. Use ONLY the facts in the user block. If a fact is missing, write
   "Not specified" or omit the section; do NOT invent values.
2. Do NOT change any compensation number. Reproduce the exact
   baseSalaryAmount, currency, and period as supplied.
3. Do NOT add bonus, commission, equity, or vacation values that
   were not supplied.
4. Do NOT mention any of the following in the offer letter:
   - Age, gender, race, ethnicity, religion, nationality, disability,
     medical information, family status, pregnancy, sexual orientation,
     political beliefs, or any other protected characteristic.
   - CV scores, interview scores, AI recommendations, decision briefs.
   - The reason the candidate was selected.
5. Do NOT promise employment guarantees or jurisdiction-specific
   legal clauses unless the user block explicitly provides them.
6. The candidate name may be used for addressing the offer.
7. Use a respectful, neutral, professional tone. No slang, no jokes.
8. The offer letter is a draft. Do not include language that asserts
   legal compliance or jurisdiction-binding enforceability.
9. If the user block contains "<COMPENSATION>Not specified</COMPENSATION>"
   or similar, write the compensation section as a placeholder
   requesting confirmation from the human recruiter.

# DISCLAIMERS (always include)

Always include the following in the "disclaimers" array (one per
element, each as a short string):
- "This offer is contingent upon the successful completion of any
   standard pre-employment checks required by company policy."
- "This document is a draft generated with AI assistance. Final
   employment terms are subject to review and approval by the
   employer and any required legal review."
- "This offer does not constitute a guarantee of employment for any
   specific duration and does not create contractual obligations
   beyond what is expressly stated herein and in the underlying
   employment agreement."
`
}

/**
 * Returns the user prompt — the fact-set the model may use.
 * Compensation is presented in an explicit, unalterable block so the
 * model cannot misread the numbers.
 */
export function buildOfferLetterUserPrompt(facts: OfferLetterPromptFacts): string {
  const comp = `${facts.baseSalaryAmount} ${facts.baseSalaryCurrency} per ${facts.baseSalaryPeriod}`
  const bonusLine = facts.bonusAmount !== null ? `\n- Bonus: ${facts.bonusAmount} ${facts.baseSalaryCurrency} (human-supplied)` : ''
  const commissionLine = facts.commissionAmount !== null ? `\n- Commission: ${facts.commissionAmount} ${facts.baseSalaryCurrency} (human-supplied)` : ''
  const equityLine = facts.equityAmount ? `\n- Equity: ${facts.equityAmount} (human-supplied)` : ''
  const vacationLine = facts.vacationDays !== null ? `\n- Vacation days: ${facts.vacationDays} days (human-supplied)` : ''

  const compBlock = `# UNALTERABLE COMPENSATION FACTS (do not change)

<COMPENSATION>
- Base salary: ${comp}
${bonusLine}${commissionLine}${equityLine}${vacationLine}
</COMPENSATION>

The compensation must be reproduced EXACTLY as above in the
"compensationSection" output. If a field is missing, do not invent it.`

  const blocks: string[] = []

  blocks.push(`# TASK

Draft a professional offer letter for the candidate using ONLY the
facts in the block below. Output JSON that matches the schema in the
system prompt. No markdown, no commentary.`)
  blocks.push('')
  blocks.push(`# CANDIDATE (address only)`)
  blocks.push(`- Name: ${facts.candidateName}`)
  blocks.push('')
  blocks.push(`# ROLE`)
  blocks.push(`- Company: ${facts.companyName}`)
  blocks.push(`- Department: ${facts.department}`)
  blocks.push(`- Job title: ${facts.jobTitle}`)
  blocks.push(`- Employment type: ${facts.employmentType ?? 'Not specified'}`)
  blocks.push(`- Work arrangement: ${facts.workArrangement ?? 'Not specified'}`)
  blocks.push(`- Hiring manager: ${facts.hiringManagerName ?? 'Not specified'}`)
  blocks.push('')
  blocks.push(`# DATES`)
  blocks.push(`- Proposed start date: ${facts.startDate ?? 'Not specified'}`)
  blocks.push(`- Offer expiry: ${facts.expiryDate ?? 'Not specified'}`)
  blocks.push('')
  blocks.push(compBlock)
  blocks.push('')
  if (facts.benefits) {
    blocks.push(`# BENEFITS (human-supplied)`)
    blocks.push(facts.benefits)
    blocks.push('')
  }
  if (facts.additionalTerms) {
    blocks.push(`# ADDITIONAL TERMS (human-supplied)`)
    blocks.push(facts.additionalTerms)
    blocks.push('')
  }
  blocks.push(`# EMPLOYMENT TERMS`)
  blocks.push(`- Probation period: ${facts.probationPeriodDays !== null ? `${facts.probationPeriodDays} days` : 'Not specified'}`)
  blocks.push(`- Notice period: ${facts.noticePeriodDays !== null ? `${facts.noticePeriodDays} days` : 'Not specified'}`)
  blocks.push('')
  blocks.push(`# REMINDER`)
  blocks.push(`Output ONLY a single JSON object. No markdown fences. No commentary.`)

  return blocks.join('\n')
}

export const offerLetterPrompt = {
  id: PROMPT_ID,
  name: PROMPT_NAME,
  version: PROMPT_VERSION,
} as const

export type { OfferLetterOutput }
