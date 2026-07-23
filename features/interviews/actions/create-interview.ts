'use server'

/**
 * Sprint 8 — server action: schedule a new interview (no kit generation).
 * Used for the "Schedule interview" flow from the AI Recruiter / candidate
 * detail page when the HR already has the questions elsewhere or wants
 * to schedule a manual one.
 */

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAuth, requirePermission, recordAuditLog } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import { getEventBus } from '@/lib/events'
import type { CreateInterviewInput, ActionResult } from '../types'

function safeRevalidate(path: string): void {
  try {
    revalidatePath(path)
  } catch {
    // Outside a request context (e.g. tsx script). Ignore.
  }
}

async function resolveNames(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { firstName: true, lastName: true },
  })
  return users.map(u => `${u.firstName} ${u.lastName}`)
}

export async function createInterviewAction(
  input: CreateInterviewInput
): Promise<ActionResult<{ interviewId: string }>> {
  const bus = getEventBus()
  try {
    // Sprint 9 PART 13: requires interview.create. Tenant-scoped.
    const auth = await requirePermission('interview.create')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId
    const actorId = auth.data.userId
    const candidate = await db.candidate.findFirst({
      where: { id: input.candidateId, organizationId: orgId },
      select: { id: true, organizationId: true, hiringRequestId: true, stage: true, firstName: true, lastName: true },
    })
    if (!candidate) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Candidate not found.', retryable: false } }
    }
    const interview = await db.interview.create({
      data: {
        organizationId: candidate.organizationId,
        hiringRequestId: candidate.hiringRequestId,
        candidateId: candidate.id,
        scheduledById: actorId,
        type: input.type ?? 'TECHNICAL',
        title: `${input.type ?? 'TECHNICAL'} — ${candidate.firstName} ${candidate.lastName}`,
        status: 'SCHEDULED',
        scheduledAt: new Date(input.scheduledAt),
        durationMinutes: input.durationMinutes,
        notes: input.notes,
        stage: 'INTERVIEW',
        round: candidate.stage === 'SCREENING' ? 1 : 2,
      },
    })
    for (const userId of input.interviewerIds) {
      await db.interviewParticipant.create({
        data: { interviewId: interview.id, userId, role: 'INTERVIEWER' },
      })
    }
    const activity = await db.activity.create({
      data: {
        organizationId: candidate.organizationId,
        type: 'INTERVIEW_SCHEDULED',
        actorId,
        candidateId: candidate.id,
        hiringRequestId: candidate.hiringRequestId,
        interviewId: interview.id,
        title: `Interview scheduled — ${interview.type}`,
        description: `${interview.durationMinutes} min · ${interview.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')}`,
      },
    })
    bus.publish({
      type: 'InterviewCreated',
      payload: {
        interviewId: interview.id,
        candidateId: candidate.id,
        hiringRequestId: candidate.hiringRequestId,
        scheduledAt: interview.scheduledAt.toISOString(),
        durationMinutes: interview.durationMinutes,
        type: interview.type,
        round: interview.round,
        participantNames: await resolveNames(input.interviewerIds),
      },
    })
    bus.publish({
      type: 'ActivityRecorded',
      payload: { activity: { id: activity.id, type: activity.type, title: activity.title, description: activity.description, actorName: null, candidateName: null, occurredAt: activity.occurredAt.toISOString() } },
    })
    safeRevalidate(`/candidates/${candidate.id}`)
    safeRevalidate(`/interview-center`)

    // Sprint 17 — Google Calendar sync (best-effort, non-blocking).
    if (interview.meetingUrl || input.location) {
      const { syncInterviewCreate } = await import('@/lib/integrations/google/service')
      const endIso = new Date(interview.scheduledAt.getTime() + interview.durationMinutes * 60_000).toISOString()
      syncInterviewCreate({
        organizationId: auth.data.organizationId,
        interviewId: interview.id,
        summary: `${interview.title} · ${candidate.firstName} ${candidate.lastName}`,
        description: interview.notes ?? undefined,
        startIso: interview.scheduledAt.toISOString(),
        endIso,
        location: input.location,
        meetingUrl: interview.meetingUrl ?? undefined,
      }).catch(err => console.error('[google-calendar] sync failed:', err))
    }
    return { ok: true, data: { interviewId: interview.id } }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to create interview.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}
