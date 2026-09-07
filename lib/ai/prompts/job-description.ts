/**
 * Job Description prompt.
 *
 * Versioned, typed, and free of side effects. The engine calls `render()`
 * with the structured input and ships the result straight to the model.
 *
 * The output instructions explicitly call for JSON (not markdown) so the
 * provider's JSON mode can be activated and the Zod schema can validate
 * the response.
 */

import type { PromptDefinition } from '../types'
import type { JobDescriptionInput } from '../types'
import { jobDescriptionOutputSchema } from '../schemas/job-description.schema'

const SCHEMA_DESCRIPTION = `{
  "title": string,
  "summary": string,
  "responsibilities": string[3..15],
  "requiredSkills": string[3..20],
  "preferredSkills": string[0..20],
  "qualifications": string[2..10],
  "benefits": string[0..15],
  "screeningQuestions": string[3..10],
  "interviewQuestions": { "category": string, "question": string }[3..20]
}`

export const jobDescriptionPrompt: PromptDefinition<JobDescriptionInput> = {
  id: 'job-description.v1',
  name: 'Job Description Generator',
  description:
    'Generates a complete, ready-to-publish job description with responsibilities, skills, qualifications, screening questions, and interview questions.',
  version: {
    version: '1.0.0',
    authoredAt: '2026-07-14',
    changelog: 'Initial version. Aligns with the JobDescription Prisma model.',
  },
  outputSchemaDescription: SCHEMA_DESCRIPTION,
  render(input: JobDescriptionInput): string {
    return [
      'You are a senior recruiting copywriter. Generate a complete, ready-to-publish job description.',
      '',
      'You MUST respond with a single JSON object matching the schema below. Do NOT include markdown, code fences, or commentary — only the JSON object.',
      '',
      `Schema: ${SCHEMA_DESCRIPTION}`,
      '',
      'Hard requirements:',
      '  - title: short, role-focused, no company name in the title.',
      '  - summary: 2–4 sentences, plain language, inclusive tone.',
      '  - responsibilities: 6–8 specific bullets that describe day-to-day work.',
      '  - requiredSkills: must-haves, 5–10 items, named technologies or competencies.',
      '  - preferredSkills: nice-to-haves, 3–8 items.',
      '  - qualifications: education + years-of-experience, 2–4 items.',
      '  - benefits: perks, comp, remote/hybrid, equity — 0–8 items.',
      '  - screeningQuestions: 5–8 questions a recruiter would ask on a 30-minute phone screen.',
      '  - interviewQuestions: 6–10 questions grouped by category (Technical, System Design, Behavioral, Culture). Each entry is { category, question }.',
      '',
      'Avoid generic clichés ("rockstar", "ninja", "fast-paced environment"). Be specific, inclusive, and grounded in the input below.',
      '',
      '--- INPUT ---',
      `Role: ${input.role}`,
      `Department: ${input.department}`,
      `Employment Type: ${input.employmentType}`,
      `Experience: ${input.experience}`,
      `Location: ${input.location}`,
      `Company Summary: ${input.companySummary}`,
      ...(input.extraContext
        ? ['', 'Additional context:', input.extraContext]
        : []),
      '',
      '--- END INPUT ---',
      '',
      'Respond with JSON only.',
    ].join('\n')
  },
}

// Re-export the schema so the engine imports both from one place.
export { jobDescriptionOutputSchema }
