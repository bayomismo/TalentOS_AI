/**
 * Interview Kit — structured output schema (placeholder).
 *
 * Used by the future `generateInterviewKit` engine method. The shape is
 * intentionally flat (categories with questions) so it round-trips
 * cleanly to the `InterviewQuestion` Prisma model.
 */

import { z } from 'zod'

export const interviewKitOutputSchema = z.object({
  role: z.string().min(1),
  totalDurationMinutes: z.number().int().min(15).max(480),
  categories: z
    .array(
      z.object({
        name: z.string().min(1),
        durationMinutes: z.number().int().min(5).max(120),
        questions: z
          .array(
            z.object({
              question: z.string().min(1),
              difficulty: z.enum(['EASY', 'MEDIUM', 'HARD', 'EXPERT']),
              expectedAnswer: z.string().min(1).optional(),
            })
          )
          .min(1)
          .max(10),
      })
    )
    .min(2)
    .max(8),
})

export type InterviewKitOutput = z.infer<typeof interviewKitOutputSchema>
