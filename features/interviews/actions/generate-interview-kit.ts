'use server'

/**
 * Sprint 8 — server action: generate (or re-generate) a candidate's
 * personalized interview kit. Thin wrapper around the service.
 */

import { generateInterviewKitService } from '../services/interview-kit-service'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import type { ActionResult, GenerateInterviewKitInput, InterviewKitView } from '../types'

export async function generateInterviewKitAction(
  input: GenerateInterviewKitInput
): Promise<ActionResult<{ interviewId: string; kit: InterviewKitView }>> {
  // Sprint 9 PART 13: requires ai.generate_interview_kit. Tenant-scoped.
  const auth = await requirePermission('ai.generate_interview_kit')
  if (!auth.ok) return toActionFailure(auth)
  // IDOR guard: the candidate must belong to the caller's org.
  const candidate = await db.candidate.findFirst({
    where: { id: input.candidateId, organizationId: auth.data.organizationId },
    select: { id: true },
  })
  if (!candidate) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Candidate not found.', retryable: false } }
  }
  return generateInterviewKitService(input)
}
