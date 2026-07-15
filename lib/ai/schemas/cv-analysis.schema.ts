/**
 * CV Analysis — structured output schema.
 *
 * Used by `AIEngine.analyzeCV()`. Returns a structured profile of the
 * candidate derived from the CV text + (optional) job context.
 *
 * The engine validates the model's JSON output against this Zod schema
 * and retries once on validation failure.
 */

import { z } from 'zod'

/**
 * Phone number — liberal format: digits, spaces, +, -, parens, dots.
 * Real validation is the recruiter's job, not the parser's.
 */
const phoneSchema = z
  .string()
  .min(5)
  .max(40)
  .regex(/^[+0-9()\-\s.]+$/, 'Phone contains invalid characters')

const experienceEntrySchema = z.object({
  company: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
  /** ISO date or YYYY-MM. */
  startDate: z.string().min(4).max(40),
  /** ISO date or "present" / null. */
  endDate: z.string().min(1).max(40).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).optional().default(''),
})

const educationEntrySchema = z.object({
  institution: z.string().min(1).max(160),
  degree: z.string().min(1).max(120),
  field: z.string().min(1).max(160),
  /** ISO date or YYYY. */
  startYear: z.string().min(2).max(20).nullable().optional(),
  /** ISO date or YYYY. */
  endYear: z.string().min(2).max(20).nullable().optional(),
})

const certificationEntrySchema = z.object({
  name: z.string().min(1).max(160),
  issuer: z.string().min(1).max(160),
  year: z.string().min(2).max(20).nullable().optional(),
})

export const cvAnalysisOutputSchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email(),
  phone: phoneSchema.optional(),
  location: z.string().max(160).optional(),
  currentTitle: z.string().min(1).max(160),
  yearsExperience: z.number().int().min(0).max(60),
  summary: z.string().min(40).max(2000),
  topSkills: z.array(z.string().min(1).max(60)).min(1).max(25),
  workExperience: z.array(experienceEntrySchema).max(15).default([]),
  education: z.array(educationEntrySchema).max(8).default([]),
  certifications: z.array(certificationEntrySchema).max(15).default([]),
  strengths: z.array(z.string().min(1).max(200)).max(10).default([]),
  concerns: z.array(z.string().min(1).max(200)).max(10).default([]),
  /** Recommended next stage. `null` means the AI couldn't decide. */
  recommendedStage: z.enum([
    'APPLIED',
    'SCREENING',
    'INTERVIEW',
    'OFFER',
    'HIRED',
    'REJECTED',
  ]),
})

export type CVAnalysisOutput = z.infer<typeof cvAnalysisOutputSchema>
