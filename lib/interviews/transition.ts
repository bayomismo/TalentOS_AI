/**
 * Sprint 19 — Shared interview status transition helper.
 *
 * The twin of `lib/candidates/transition.ts`, for the interview state
 * machine (`./state-machine.ts`).
 *
 * DESIGN RULES (identical to the candidate helper, on purpose):
 *
 *   1. It takes a `Prisma.TransactionClient` — it NEVER imports
 *      `@/lib/db`. The caller owns the transaction, so the status write
 *      and the activity write commit or roll back together.
 *   2. An illegal transition is a RETURNED RESULT, never a thrown
 *      error: `{ ok: false, error: { code: 'INVALID_INTERVIEW_TRANSITION' } }`.
 *      The caller decides how to surface it.
 *   3. A database error is NOT swallowed: it propagates so the caller's
 *      transaction rolls back.
 *   4. It writes NO Activity and NO AuditLog rows. Those belong to the
 *      caller, which knows the actor and the surrounding context.
 *
 * WHY THIS EXISTS (audit P1-08)
 *
 *   `CANCELLED`, `NO_SHOW` and `RESCHEDULED` existed in the schema with
 *   no reachable write path, so a cancelled interview stayed `SCHEDULED`
 *   forever and its reminders kept firing. Making the statuses reachable
 *   means every writer has to agree on what the legal edges are — that
 *   agreement lives in one place, here.
 *
 * TRANSACTION CLIENT CONTRACT
 *
 *   The helper uses exactly two calls on the transaction client:
 *
 *     tx.interview.findUnique({ where: { id }, select: { status: true } })
 *     tx.interview.update({ where: { id }, data: {...}, select: { id: true } })
 *
 *   A test double only has to implement those two.
 */

import type { InterviewStatus, Prisma } from '@prisma/client'
import { validateInterviewTransition } from './state-machine'

export interface InterviewTransitionInput {
  interviewId: string
  toStatus: InterviewStatus
  /** Stamp `startedAt` when the interview moves to IN_PROGRESS. */
  startedAt?: Date | null
  /** Stamp `completedAt` when the interview moves to COMPLETED. */
  completedAt?: Date | null
  /** Free-text reason, stored on `cancelledReason` for CANCELLED. */
  cancelledReason?: string | null
  /** New slot — used by a reschedule. */
  scheduledAt?: Date
  durationMinutes?: number
}

export type InterviewTransitionResult =
  | {
      ok: true
      data: {
        interviewId: string
        fromStatus: string
        toStatus: string
        code: string
      }
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

/**
 * Moves an interview to a new status, inside the caller's transaction.
 *
 * On success the row carries the new status plus the lifecycle timestamp
 * that belongs to it (`startedAt` for IN_PROGRESS, `completedAt` for
 * COMPLETED, `cancelledReason` for CANCELLED).
 *
 * Returns a failure result — never throws — when the transition is
 * illegal or the interview does not exist. Database errors propagate.
 */
export async function transitionInterviewStatus(
  tx: Prisma.TransactionClient,
  input: InterviewTransitionInput,
): Promise<InterviewTransitionResult> {
  const interview = await tx.interview.findUnique({
    where: { id: input.interviewId },
    select: { id: true, status: true },
  })

  if (!interview) {
    return {
      ok: false,
      error: {
        code: 'INTERVIEW_NOT_FOUND',
        message: 'Interview not found.',
        retryable: false,
      },
    }
  }

  const validation = validateInterviewTransition(interview.status, input.toStatus)
  if (!validation.ok) {
    const namesBothStatuses =
      validation.reason.includes(interview.status) && validation.reason.includes(input.toStatus)
    return {
      ok: false,
      error: {
        code: 'INVALID_INTERVIEW_TRANSITION',
        message: namesBothStatuses
          ? validation.reason
          : `Cannot move interview from ${interview.status} to ${input.toStatus}. ${validation.reason}`,
        retryable: false,
      },
    }
  }

  const now = new Date()

  await tx.interview.update({
    where: { id: input.interviewId },
    data: {
      status: input.toStatus,
      ...(input.toStatus === 'IN_PROGRESS'
        ? { startedAt: input.startedAt ?? now }
        : {}),
      ...(input.toStatus === 'COMPLETED'
        ? { completedAt: input.completedAt ?? now }
        : {}),
      ...(input.toStatus === 'CANCELLED'
        ? { cancelledReason: input.cancelledReason ?? null }
        : {}),
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
      ...(input.durationMinutes ? { durationMinutes: input.durationMinutes } : {}),
    },
    select: { id: true },
  })

  return {
    ok: true,
    data: {
      interviewId: input.interviewId,
      fromStatus: interview.status,
      toStatus: input.toStatus,
      code: validation.code,
    },
  }
}
