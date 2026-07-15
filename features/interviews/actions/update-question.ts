'use server'

/**
 * Sprint 8 — server action: mark a single interview question as
 * asked/notes. This is the in-flight annotation the interviewer uses
 * during the call.
 */

import { db } from '@/lib/db'
import { findInterviewQuestion, markInterviewQuestionAsked } from '../repositories/interview-repository'
import type { ActionResult, MarkQuestionAskedInput } from '../types'

export async function markInterviewQuestionAskedAction(
  input: MarkQuestionAskedInput
): Promise<ActionResult<{ askedAt: string | null }>> {
  try {
    const question = await findInterviewQuestion(input.questionId)
    if (!question) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Question not found.', retryable: false } }
    }
    const askedAt = input.asked ? new Date() : null
    await markInterviewQuestionAsked(input.questionId, askedAt, input.notes)
    return { ok: true, data: { askedAt: askedAt ? askedAt.toISOString() : null } }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to mark question asked.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

export async function markInterviewStartedAction(
  interviewId: string
): Promise<ActionResult<{ startedAt: string }>> {
  try {
    const interview = await db.interview.findUnique({
      where: { id: interviewId },
      select: { id: true, candidateId: true, status: true, startedAt: true },
    })
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }
    if (interview.startedAt) {
      return { ok: true, data: { startedAt: interview.startedAt.toISOString() } }
    }
    const startedAt = new Date()
    await db.interview.update({
      where: { id: interview.id },
      data: { startedAt, status: 'IN_PROGRESS' },
    })
    return { ok: true, data: { startedAt: startedAt.toISOString() } }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: 'Failed to start interview.', retryable: true, details: err instanceof Error ? err.message : String(err) } }
  }
}
