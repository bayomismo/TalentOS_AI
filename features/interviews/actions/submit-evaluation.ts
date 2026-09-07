'use server'

/**
 * Sprint 8 — server action: submit a structured evaluation. Thin wrapper
 * around the evaluation service. Re-validates the kit snapshot exists
 * + publishes events at the action layer.
 */

import { revalidatePath } from 'next/cache'
import { submitEvaluationService } from '../services/interview-evaluation-service'
import { db } from '@/lib/db'
import { requireAuth, requirePermission, recordAuditLog } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import type { ActionResult, SubmitEvaluationInput } from '../types'

function safeRevalidate(path: string): void {
  try {
    revalidatePath(path)
  } catch {
    // Outside a request context. Ignore.
  }
}

export async function submitEvaluationAction(
  input: SubmitEvaluationInput
): Promise<ActionResult<{ evaluationId: string; interviewScore: number }>> {
  // Sprint 9 PART 13: requires interview.evaluate. PART 11: INTERVIEWER can
  // only submit evaluations for interviews they participate in.
  const auth = await requirePermission('interview.evaluate')
  if (!auth.ok) return toActionFailure(auth)
  const orgId = auth.data.organizationId

  // PART 6: IDOR guard — interview must belong to this org.
  const interview = await db.interview.findFirst({
    where: { id: input.interviewId, organizationId: orgId },
    include: { participants: { select: { userId: true } } },
  })
  if (!interview) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
  }
  if (auth.data.role === 'INTERVIEWER' && !interview.participants.some(p => p.userId === auth.data.userId)) {
    await recordAuditLog({
      organizationId: orgId,
      actorId: auth.data.userId,
      action: 'ACCESS_DENIED',
      targetType: 'interview',
      targetId: interview.id,
      outcome: 'denied',
      reason: 'interviewer_not_participant',
    })
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
  }

  const result = await submitEvaluationService({ ...input, evaluatorId: auth.data.userId })
  if (result.ok) {
    // The service doesn't know about revalidate; we do it here.
    try {
      const interview = await db.interview.findUnique({
        where: { id: input.interviewId },
        select: { candidateId: true },
      })
      if (interview) {
        safeRevalidate(`/candidates/${interview.candidateId}`)
        safeRevalidate(`/candidates/${interview.candidateId}/interview-kit/${input.interviewId}`)
        safeRevalidate(`/interview-center`)
      }
    } catch {
      // ignore
    }
  }
  return result
}
