/**
 * CV Analysis prompt.
 *
 * Renders a structured recruiter-grade CV analysis request. The
 * returned JSON is validated against `cvAnalysisOutputSchema`.
 *
 * Fairness safeguards (model must follow):
 *   - Score ONLY on job-relevant professional criteria.
 *   - Do not infer or use: gender, age, race, ethnicity, religion,
 *     nationality, marital status, disability, photo, or any assumption
 *     derived from the candidate's name.
 *   - Names are extracted for identification and may not influence any
 *     rating or recommendation.
 */

import type { PromptDefinition } from '../types'
import { cvAnalysisOutputSchema } from '../schemas/cv-analysis.schema'

export interface CVAnalysisInput {
  /** Raw CV text (already parsed out of the PDF/DOCX). */
  cvText: string
  /** Optional job context to make the analysis job-aware. */
  jobContext?: {
    title: string
    summary?: string
    requiredSkills?: string[]
    niceToHaveSkills?: string[]
  }
}

const SCHEMA_DESCRIPTION = `{
  "fullName": string,
  "email": string (RFC-5322),
  "phone"?: string,
  "location"?: string,
  "currentTitle": string,
  "yearsExperience": integer (0-60),
  "summary": string (40-2000 chars, professional summary),
  "topSkills": string[1..25],
  "workExperience": [{ company, title, startDate, endDate?, location?, description? }],
  "education": [{ institution, degree, field, startYear?, endYear? }],
  "certifications": [{ name, issuer, year? }],
  "strengths": string[0..10],
  "concerns": string[0..10],
  "recommendedStage": "APPLIED" | "SCREENING" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED"
}`

export const cvAnalysisPrompt: PromptDefinition<CVAnalysisInput> = {
  id: 'cv-analysis.v1',
  name: 'CV Analysis',
  description:
    'Extracts a structured candidate profile from raw CV text, with a job-aware recommended next stage.',
  version: {
    version: '1.0.0',
    authoredAt: '2026-07-15',
    changelog: 'Sprint 6: real implementation. Adds fairness safeguards and job-aware stage recommendation.',
  },
  outputSchemaDescription: SCHEMA_DESCRIPTION,
  render(input: CVAnalysisInput): string {
    const jobContextBlock = input.jobContext
      ? `
JOB CONTEXT (the role the CV is being evaluated for):
- Title: ${input.jobContext.title}
- Summary: ${input.jobContext.summary ?? '(none)'}
- Required skills: ${(input.jobContext.requiredSkills ?? []).join(', ') || '(none)'}
- Nice-to-have skills: ${(input.jobContext.niceToHaveSkills ?? []).join(', ') || '(none)'}

Use the job context to choose the recommended next stage:
  - APPLIED if the candidate is a clear fit to be screened
  - SCREENING if the candidate looks strong and is worth a phone screen
  - INTERVIEW if the candidate is a clear fit and ready to interview
  - OFFER if the candidate is exceptional
  - HIRED only if explicitly told to recommend hiring
  - REJECTED only if the candidate clearly does not match the role
`.trim()
      : ''

    return `
You are a senior technical recruiter writing a CV analysis for an HR platform.

Extract a structured candidate profile from the CV text below. Be precise,
factual, and conservative. Do not invent experiences, employers, dates, or
skills that the CV does not state. If a field is not present in the CV, omit
it or use null. Use ISO date format (YYYY-MM or YYYY-MM-DD) for any date.

FAIRNESS SAFEGUARDS (NON-NEGOTIABLE):
- Score and assess ONLY on job-relevant professional information.
- NEVER infer, use, or comment on: gender, age, race, ethnicity, religion,
  nationality, marital status, disability, photo, or any characteristic
  that is not a verifiable professional qualification.
- The candidate's name is for identification only. It MUST NOT influence
  the analysis, the strengths/concerns lists, or the recommended stage.
- If the CV is in a language other than English, respond in English but
  preserve the original-language job titles and institution names.

YEARS OF EXPERIENCE:
- Calculate total professional experience from the employment history.
- Where multiple roles overlap in time, count each period only once
  (the candidate cannot be working two full-time jobs simultaneously).
- Round down to the nearest whole year.
- If the CV states a self-reported number, prefer the calculated number
  when they disagree, but use the CV's number if no history is available.

${jobContextBlock}

CV TEXT:
"""
${input.cvText.slice(0, 20000)}
"""

Return ONLY the JSON object described by the schema. No prose, no markdown
fences, no commentary. The output must be valid JSON.
`.trim()
  },
}

export { cvAnalysisOutputSchema }
