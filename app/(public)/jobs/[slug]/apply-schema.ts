/**
 * Sprint 17.6 / hardening — structural validation for the public job
 * application body.
 *
 * Kept in its own module (no `server-only`, no DB) so it can be unit
 * tested and imported from both the server action and the API route.
 *
 * This is a SHAPE + gross-size gate only. The user-friendly per-field
 * checks (email format, consent, trimmed name length) still run inside
 * the action and return their own error codes. The maxes here are abuse
 * ceilings (~10x the functional limits), not UX limits.
 */
import { z } from 'zod'
import { MAX_CV_BYTES } from '@/lib/cv/validate'

/**
 * Max length of the base64 CV string we will even attempt to decode.
 * Exact base64 expansion of `MAX_CV_BYTES`, rounded up to a 4-char group.
 * Checked BEFORE `Buffer.from` so an oversized payload is never
 * materialised in memory.
 */
export const MAX_CV_BASE64_CHARS = Math.ceil(MAX_CV_BYTES / 3) * 4

export const applicationSchema = z.object({
  jobSlug: z.string().min(1).max(300),
  firstName: z.string().max(400),
  lastName: z.string().max(400),
  email: z.string().max(320),
  phone: z.string().max(200).nullish(),
  location: z.string().max(1000).nullish(),
  linkedinUrl: z.string().max(4000).nullish(),
  portfolioUrl: z.string().max(4000).nullish(),
  githubUrl: z.string().max(4000).nullish(),
  coverLetter: z.string().max(40000).nullish(),
  cv: z
    .object({
      dataBase64: z.string().max(20_000_000),
      fileName: z.string().max(255),
      mimeType: z.string().max(255),
    })
    .nullish(),
  website: z.string().max(400).optional(),
  consent: z.string().max(40).optional(),
})
// Unknown keys are dropped (zod v4 default). We do NOT `.strict()` so a
// future frontend field can't hard-break existing submissions.

export type SubmitPublicApplicationInput = z.infer<typeof applicationSchema>
