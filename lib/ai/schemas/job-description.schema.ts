/**
 * Job Description — structured output schema.
 *
 * The shape mirrors the `JobDescription` Prisma model so the engine can
 * return data that drops straight into the database when persistence is
 * wired up. Fields the DB doesn't carry (e.g. `qualifications`,
 * `screeningQuestions`, `interviewQuestions`) are returned alongside so
 * the engine can drive a full hiring package in one call.
 */

import { z } from 'zod'

export const jobDescriptionOutputSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(20).max(2_000),

  responsibilities: z.array(z.string().min(1)).min(3).max(15),

  requiredSkills: z.array(z.string().min(1)).min(3).max(20),
  preferredSkills: z.array(z.string().min(1)).max(20).default([]),

  qualifications: z.array(z.string().min(1)).min(2).max(10),

  benefits: z.array(z.string().min(1)).max(15).default([]),

  screeningQuestions: z.array(z.string().min(1)).min(3).max(10),
  interviewQuestions: z
    .array(
      z.object({
        category: z.string().min(1),
        question: z.string().min(1),
      })
    )
    .min(3)
    .max(20),
})

export type JobDescriptionOutput = z.infer<typeof jobDescriptionOutputSchema>
