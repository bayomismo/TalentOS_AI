'use server'

/**
 * Sprint 8 — server action: submit a structured evaluation. Thin wrapper
 * around the evaluation service. Re-validates the kit snapshot exists
 * + publishes events at the action layer.
 */

import { revalidatePath } from 'next/cache'
import { submitEvaluationService } from '../services/interview-evaluation-service'
import { db } from '@/lib/db'
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
  const result = await submitEvaluationService(input)
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
