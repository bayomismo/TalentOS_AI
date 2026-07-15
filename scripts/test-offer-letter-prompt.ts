/**
 * Sprint 10 — AI Offer Letter prompt guardrails.
 *
 * Static tests (no Gemini). They verify that:
 *  - The system prompt explicitly forbids inventing or altering
 *    compensation values, protected characteristics, and CV/interview
 *    scores.
 *  - The user prompt renders the human-supplied compensation
 *    VERBATIM in the prompt so the model cannot misread.
 *  - The structured-output schema accepts the full section set.
 *
 * A separate live test (when Gemini quota is available) verifies the
 * actual generation; this file is the always-on guarantee.
 */

import {
  buildOfferLetterSystemPrompt,
  buildOfferLetterUserPrompt,
  offerLetterPrompt,
  type OfferLetterPromptFacts,
} from '../lib/ai/prompts/offer-letter'
import { offerLetterOutputSchema, type OfferLetterOutput } from '../lib/ai/schemas/offer-letter.schema'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', name); pass++ }
  else { console.log('  ✗', name, detail ?? ''); fail++ }
}

const sampleFacts: OfferLetterPromptFacts = {
  candidateName: 'Sarah Chen',
  jobTitle: 'Senior Product Manager',
  department: 'Product',
  employmentType: 'FULL_TIME',
  workArrangement: 'HYBRID',
  startDate: '2026-08-01T00:00:00.000Z',
  expiryDate: '2026-07-25T00:00:00.000Z',
  companyName: 'Acme Co.',
  hiringManagerName: 'Marcus Kim',
  baseSalaryAmount: 120000,
  baseSalaryCurrency: 'USD',
  baseSalaryPeriod: 'annual',
  bonusAmount: null,
  equityAmount: '0.05% over 4 years',
  commissionAmount: null,
  vacationDays: 20,
  benefits: 'Health, dental, vision, 401k match up to 4%.',
  additionalTerms: 'Signing bonus $10,000, paid in first month.',
  probationPeriodDays: 90,
  noticePeriodDays: 30,
}

console.log('A. System prompt guardrails')
const system = buildOfferLetterSystemPrompt()
check('A.1 system prompt exists', system.length > 100)
check('A.2 forbids inventing compensation', /do NOT invent|do not invent/i.test(system))
check('A.3 forbids changing compensation', /do NOT change|do not change/i.test(system))
check('A.4 forbids adding missing values', /do NOT add|do not add/i.test(system))
check('A.5 forbids employment guarantees', /guarantee|do not promise/i.test(system))
check('A.6 forbids protected characteristics', /age|gender|race|ethnicity|religion|nationality|disability|family status|sexual orientation/i.test(system))
check('A.7 forbids CV/interview scores', /CV score|interview score/i.test(system))
check('A.8 forbids AI recommendations', /AI recommendation|decision brief/i.test(system))
check('A.9 requires JSON output', /JSON|json/i.test(system))
check('A.10 includes AI-draft disclaimer guidance', /draft|review|legal/i.test(system))

console.log('\nB. User prompt renders facts verbatim')
const user = buildOfferLetterUserPrompt(sampleFacts)
check('B.1 user prompt contains the candidate name', user.includes('Sarah Chen'))
check('B.2 user prompt contains the exact salary number', user.includes('120000'))
check('B.3 user prompt contains the exact currency', user.includes('USD'))
check('B.4 user prompt contains the exact period', user.includes('annual'))
check('B.5 user prompt contains the equity value', user.includes('0.05% over 4 years'))
check('B.6 user prompt contains the start date', user.includes('2026-08-01'))
check('B.7 user prompt contains the benefits text', user.includes('Health, dental, vision'))
check('B.8 user prompt contains the additional terms', user.includes('Signing bonus $10,000'))
check('B.9 user prompt does NOT include CV parsed text', !user.includes('CV parsed'))
check('B.10 user prompt does NOT include interview evaluation', !user.includes('Interview Evaluation'))
check('B.11 user prompt does NOT include AI Candidate Analysis', !user.includes('AI Candidate Analysis'))
check('B.12 user prompt does NOT include Decision Brief', !user.includes('Decision Brief'))
check('B.13 user prompt does NOT include protected characteristics as fields', !/age\s*[:=]|race\s*[:=]|religion\s*[:=]|gender\s*[:=]|disability\s*[:=]/.test(user.toLowerCase()))

console.log('\nC. Compensation block is wrapped in an "unalterable" tag')
check('C.1 prompt contains <COMPENSATION> tag', user.includes('<COMPENSATION>'))
check('C.2 prompt contains </COMPENSATION> tag', user.includes('</COMPENSATION>'))
check('C.3 prompt says "do not change" for compensation', /reproduce|do not change|unalterable/i.test(user))

console.log('\nD. Output schema')
const sampleOutput: OfferLetterOutput = {
  title: 'Offer of Employment',
  opening: 'Dear Sarah Chen,',
  roleSummary: 'We are pleased to offer you the role of Senior Product Manager.',
  compensationSection: 'Your annual base salary will be USD 120,000, subject to applicable deductions.',
  benefitsSection: 'You will receive health, dental, vision, and 401k match up to 4%.',
  employmentTermsSection: 'Employment type: FULL_TIME. Work arrangement: HYBRID. Probation: 90 days. Notice: 30 days.',
  startDateSection: 'Your proposed start date is 2026-08-01.',
  acceptanceInstructions: 'Please confirm by 2026-07-25.',
  closing: 'Sincerely,',
  disclaimers: ['This offer is contingent upon successful completion of standard pre-employment checks.'],
}
const parsed = offerLetterOutputSchema.safeParse(sampleOutput)
check('D.1 sample output validates', parsed.success)
check('D.2 required fields enforced', parsed.success && parsed.data.title === 'Offer of Employment')

// Negative test: missing a required field
const invalid = { ...sampleOutput, opening: '' }
const parsed2 = offerLetterOutputSchema.safeParse(invalid)
check('D.3 empty required string rejected', !parsed2.success)

console.log('\nE. Prompt version + id')
check('E.1 prompt has stable id', offerLetterPrompt.id === 'offer-letter.v1')
check('E.2 prompt has version', !!offerLetterPrompt.version)

console.log(`\n=== ${pass} passed, ${fail} failed ===`)
process.exit(fail > 0 ? 1 : 0)
