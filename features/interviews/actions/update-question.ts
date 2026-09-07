'use server'

/**
 * Sprint 8 — server action: mark a single interview question as
 * asked/notes. This is the in-flight annotation the interviewer uses
 * during the call.
 */

import { db } from '@/lib/db'
import { requireAuth, requirePermission, recordAuditLog } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import { findInterviewQuestion, markInterviewQuestionAsked } from '../repositories/interview-repository'
import type { ActionResult, MarkQuestionAskedInput } from '../types'

export async function markInterviewQuestionAskedAction(
  input: MarkQuestionAskedInput
): Promise<ActionResult<{ askedAt: string | null }>> {
  try {
    // Sprint 9 PART 13: interview.evaluate. PART 11: INTERVIEWER can only
    // annotate interviews they participate in.
    const auth = await requirePermission('interview.evaluate')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId
    const question = await db.interviewQuestion.findFirst({
      where: { id: input.questionId, interview: { organizationId: orgId } },
      include: { interview: { include: { participants: { select: { userId: true } } } } },
    })
    if (!question) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Question not found.', retryable: false } }
    }
    if (auth.data.role === 'INTERVIEWER' && !question.interview.participants.some(p => p.userId === auth.data.userId)) {
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
    // Sprint 9 PART 13: interview.schedule. PART 11: INTERVIEWER can only
    // start interviews they participate in.
    const auth = await requirePermission('interview.schedule')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId
    const interview = await db.interview.findFirst({
      where: { id: interviewId, organizationId: orgId },
      include: { participants: { select: { userId: true } } },
    })
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }
    if (auth.data.role === 'INTERVIEWER' && !interview.participants.some(p => p.userId === auth.data.userId)) {
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
