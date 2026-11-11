'use server'

/**
 * Sprint 19 (audit P1-08) — the interview lifecycle transitions.
 *
 * `CANCELLED`, `RESCHEDULED` and `NO_SHOW` existed in the schema with
 * NO reachable write path. A candidate who cancelled, a panel that moved
 * the slot, a candidate who never turned up — none of it was recorded.
 * The interview stayed `SCHEDULED` forever and its reminders kept
 * firing.
 *
 * These three actions are that missing write path. All of them:
 *
 *   1. require `interview.schedule` through the RBAC matrix (never a
 *      hand-rolled role list);
 *   2. read the interview through a tenant-scoped query that ALSO
 *      filters the foreign keys (the candidate and the hiring request
 *      must belong to the caller's organization too);
 *   3. go through `lib/interviews/state-machine.ts`, so an illegal
 *      transition is a clean, typed refusal — not a raw write;
 *   4. write the status change and its timeline entry in ONE
 *      transaction, so the history can never drift from the state.
 */

import { revalidatePath } from 'next/cache'
import { InterviewStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { requirePermission, recordAuditLog } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import { getEventBus } from '@/lib/events'
import { transitionInterviewStatus } from '@/lib/interviews/transition'
import { findInterviewForOrg } from '../repositories/interview-repository'
import type { ActionResult } from '../types'

function safeRevalidate(path: string): void {
  try {
    revalidatePath(path)
  } catch {
    // Outside a request context (e.g. tsx script). Ignore.
  }
}

interface LifecycleResult {
  interviewId: string
  status: string
  scheduledAt: string
}

async function publishActivity(activity: {
  id: string
  type: string
  title: string
  description: string | null
  occurredAt: Date
}): Promise<void> {
  getEventBus().publish({
    type: 'ActivityRecorded',
    payload: {
      activity: {
        id: activity.id,
        type: activity.type,
        title: activity.title,
        description: activity.description,
        actorName: null,
        candidateName: null,
        occurredAt: activity.occurredAt.toISOString(),
      },
    },
  })
}

// -----------------------------------------------------------------------------
// 1. Cancel an interview
// -----------------------------------------------------------------------------

export async function cancelInterviewAction(
  interviewId: string,
  reason?: string
): Promise<ActionResult<LifecycleResult>> {
  try {
    const auth = await requirePermission('interview.schedule')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    const interview = await findInterviewForOrg(interviewId, orgId)
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }

    const result = await db.$transaction(async (tx) => {
      const moved = await transitionInterviewStatus(tx, {
        interviewId: interview.id,
        toStatus: InterviewStatus.CANCELLED,
        cancelledReason: reason ?? null,
      })
      if (!moved.ok) return moved
      const activity = await tx.activity.create({
        data: {
          organizationId: orgId,
          type: 'INTERVIEW_CANCELLED',
          actorId: auth.data.userId,
          candidateId: interview.candidateId,
          hiringRequestId: interview.hiringRequest.id,
          interviewId: interview.id,
          title: `Interview cancelled — ${interview.candidate.firstName} ${interview.candidate.lastName}`,
          description: reason ?? 'No reason given.',
          metadata: { fromStatus: moved.data.fromStatus, toStatus: moved.data.toStatus },
        },
      })
      return { ok: true as const, data: { moved, activity } }
    })

    if (!result.ok) {
      return { ok: false, error: { code: result.error.code, message: result.error.message, retryable: false } }
    }

    await recordAuditLog({
      organizationId: orgId,
      actorId: auth.data.userId,
      action: 'INTERVIEW_CANCELLED',
      targetType: 'interview',
      targetId: interview.id,
      outcome: 'success',
      metadata: { reason: reason ?? null },
    })
    await publishActivity(result.data.activity)
    safeRevalidate('/interview-center')
    safeRevalidate(`/candidates/${interview.candidateId}`)

    const row = await db.interview.findUnique({
      where: { id: interview.id },
      select: { status: true, scheduledAt: true },
    })
    return {
      ok: true,
      data: {
        interviewId: interview.id,
        status: row?.status ?? InterviewStatus.CANCELLED,
        scheduledAt: row?.scheduledAt.toISOString() ?? new Date().toISOString(),
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to cancel interview.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

// -----------------------------------------------------------------------------
// 2. Reschedule an interview
// -----------------------------------------------------------------------------

export async function rescheduleInterviewAction(
  interviewId: string,
  scheduledAt: string | Date,
  durationMinutes?: number,
  reason?: string
): Promise<ActionResult<LifecycleResult>> {
  try {
    const auth = await requirePermission('interview.schedule')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    const interview = await findInterviewForOrg(interviewId, orgId)
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }

    const newSlot = new Date(scheduledAt)
    if (Number.isNaN(newSlot.getTime())) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Invalid date.', retryable: false } }
    }

    const result = await db.$transaction(async (tx) => {
      // The state machine has two edges for a reschedule:
      //
      //   SCHEDULED → RESCHEDULED   (the slot is moved)
      //   RESCHEDULED → SCHEDULED   (the new slot is confirmed)
      //   NO_SHOW   → RESCHEDULED   (a no-show is re-booked)
      //
      // The interview therefore passes THROUGH `RESCHEDULED` — the
      // status is recorded, not skipped — and ends up SCHEDULED at the
      // new time.
      const moved = await transitionInterviewStatus(tx, {
        interviewId: interview.id,
        toStatus: InterviewStatus.RESCHEDULED,
        scheduledAt: newSlot,
        ...(durationMinutes ? { durationMinutes } : {}),
      })
      if (!moved.ok) return moved
      const confirmed = await transitionInterviewStatus(tx, {
        interviewId: interview.id,
        toStatus: InterviewStatus.SCHEDULED,
      })
      if (!confirmed.ok) return confirmed
      const activity = await tx.activity.create({
        data: {
          organizationId: orgId,
          type: 'INTERVIEW_RESCHEDULED',
          actorId: auth.data.userId,
          candidateId: interview.candidateId,
          hiringRequestId: interview.hiringRequest.id,
          interviewId: interview.id,
          title: `Interview rescheduled — ${interview.candidate.firstName} ${interview.candidate.lastName}`,
          description: `New slot: ${newSlot.toISOString()}${reason ? ` · ${reason}` : ''}`,
          metadata: {
            fromStatus: moved.data.fromStatus,
            toStatus: 'SCHEDULED',
            scheduledAt: newSlot.toISOString(),
            viaStatus: 'RESCHEDULED',
          },
        },
      })
      return { ok: true as const, data: { moved, confirmed, activity } }
    })

    if (!result.ok) {
      return { ok: false, error: { code: result.error.code, message: result.error.message, retryable: false } }
    }

    await recordAuditLog({
      organizationId: orgId,
      actorId: auth.data.userId,
      action: 'INTERVIEW_RESCHEDULED',
      targetType: 'interview',
      targetId: interview.id,
      outcome: 'success',
      metadata: { scheduledAt: newSlot.toISOString(), reason: reason ?? null },
    })
    await publishActivity(result.data.activity)
    safeRevalidate('/interview-center')
    safeRevalidate(`/candidates/${interview.candidateId}`)

    return {
      ok: true,
      data: {
        interviewId: interview.id,
        status: InterviewStatus.SCHEDULED,
        scheduledAt: newSlot.toISOString(),
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to reschedule interview.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

// -----------------------------------------------------------------------------
// 3. Mark an interview as a no-show
// -----------------------------------------------------------------------------

export async function markInterviewNoShowAction(
  interviewId: string,
  note?: string
): Promise<ActionResult<LifecycleResult>> {
  try {
    const auth = await requirePermission('interview.schedule')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    const interview = await findInterviewForOrg(interviewId, orgId)
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }

    const result = await db.$transaction(async (tx) => {
      const moved = await transitionInterviewStatus(tx, {
        interviewId: interview.id,
        toStatus: InterviewStatus.NO_SHOW,
      })
      if (!moved.ok) return moved
      const activity = await tx.activity.create({
        data: {
          organizationId: orgId,
          type: 'INTERVIEW_NO_SHOW',
          actorId: auth.data.userId,
          candidateId: interview.candidateId,
          hiringRequestId: interview.hiringRequest.id,
          interviewId: interview.id,
          title: `Interview marked as no-show — ${interview.candidate.firstName} ${interview.candidate.lastName}`,
          description: note ?? 'Nobody attended the interview.',
          metadata: { fromStatus: moved.data.fromStatus, toStatus: moved.data.toStatus },
        },
      })
      return { ok: true as const, data: { moved, activity } }
    })

    if (!result.ok) {
      return { ok: false, error: { code: result.error.code, message: result.error.message, retryable: false } }
    }

    await recordAuditLog({
      organizationId: orgId,
      actorId: auth.data.userId,
      action: 'INTERVIEW_NO_SHOW',
      targetType: 'interview',
      targetId: interview.id,
      outcome: 'success',
      metadata: { note: note ?? null },
    })
    await publishActivity(result.data.activity)
    safeRevalidate('/interview-center')
    safeRevalidate(`/candidates/${interview.candidateId}`)

    const row = await db.interview.findUnique({
      where: { id: interview.id },
      select: { status: true, scheduledAt: true },
    })
    return {
      ok: true,
      data: {
        interviewId: interview.id,
        status: row?.status ?? InterviewStatus.NO_SHOW,
        scheduledAt: row?.scheduledAt.toISOString() ?? new Date().toISOString(),
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to mark the interview as a no-show.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}
