'use server'

/**
 * Sprint 8 — server action: schedule a new interview (no kit generation).
 * Used for the "Schedule interview" flow from the AI Recruiter / candidate
 * detail page when the HR already has the questions elsewhere or wants
 * to schedule a manual one.
 */

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { ApplicationStage } from '@prisma/client'
import { requireAuth, requirePermission, recordAuditLog } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import { getEventBus } from '@/lib/events'
import { canReceiveDecisionOrOffer } from '@/lib/candidates/state-machine'
import { transitionCandidateStage } from '@/lib/candidates/transition'
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

    // -----------------------------------------------------------------------
    // Audit P1-09 — scheduling an interview used to bypass the candidate
    // stage rules entirely: a REJECTED or HIRED candidate could be
    // scheduled, two concurrent interviews collided on the same "round",
    // and the candidate's stage was never advanced, so the pipeline board
    // and the interview list disagreed about where the candidate was.
    // -----------------------------------------------------------------------

    // 1. A terminal candidate cannot be interviewed.
    if (!canReceiveDecisionOrOffer(candidate.stage)) {
      return {
        ok: false,
        error: {
          code: 'TERMINAL_STAGE',
          message:
            `${candidate.firstName} ${candidate.lastName} is at stage ${candidate.stage}. ` +
            'A candidate in a terminal stage (HIRED, REJECTED or WITHDRAWN) cannot be scheduled for an interview.',
          retryable: false,
        },
      }
    }

    // 2. No concurrent open interview for the same candidate.
    const openInterview = await db.interview.findFirst({
      where: {
        candidateId: candidate.id,
        organizationId: orgId,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      },
      select: { id: true, scheduledAt: true },
    })
    if (openInterview) {
      return {
        ok: false,
        error: {
          code: 'DUPLICATE_INTERVIEW',
          message:
            'This candidate already has an open interview. ' +
            'Reschedule or cancel it before scheduling another one.',
          retryable: false,
        },
      }
    }

    // 3. The round is the number of interviews this candidate already
    //    had — not a guess derived from the stage.
    const previousInterviews = await db.interview.count({
      where: { candidateId: candidate.id, organizationId: orgId },
    })
    const round = previousInterviews + 1

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
        location: input.location ?? null,
        stage: 'INTERVIEW',
        round,
      },
    })
    for (const userId of input.interviewerIds) {
      await db.interviewParticipant.create({
        data: { interviewId: interview.id, userId, role: 'INTERVIEWER' },
      })
    }

    // 4. The candidate's stage follows the interview. The write goes
    //    through the shared transition helper, so it is validated and the
    //    Application mirror stays in step. A candidate already in
    //    INTERVIEW keeps their stage (INTERVIEW → INTERVIEW is not a
    //    transition).
    let stageUpdated = false
    if (candidate.stage === 'APPLIED' || candidate.stage === 'SCREENING') {
      const moved = await db.$transaction(async (tx) =>
        transitionCandidateStage(tx, {
          candidateId: candidate.id,
          toStage: ApplicationStage.INTERVIEW,
          actorId,
          reason: `Interview scheduled (round ${round}).`,
        }),
      )
      if (!moved.ok) {
        return {
          ok: false,
          error: { code: moved.error.code, message: moved.error.message, retryable: false },
        }
      }
      stageUpdated = true
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
        description: `${interview.durationMinutes} min · ${interview.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')} · round ${round}`,
        metadata: { round, stageUpdated },
      },
    })
    if (stageUpdated) {
      const stageActivity = await db.activity.create({
        data: {
          organizationId: candidate.organizationId,
          type: 'CANDIDATE_MOVED',
          actorId,
          candidateId: candidate.id,
          hiringRequestId: candidate.hiringRequestId,
          interviewId: interview.id,
          title: `Candidate moved to INTERVIEW`,
          description: `Advanced from ${candidate.stage} when the interview was scheduled.`,
          metadata: { fromStage: candidate.stage, toStage: 'INTERVIEW', trigger: 'INTERVIEW_SCHEDULED' },
        },
      })
      bus.publish({
        type: 'ActivityRecorded',
        payload: { activity: { id: stageActivity.id, type: stageActivity.type, title: stageActivity.title, description: stageActivity.description, actorName: null, candidateName: null, occurredAt: stageActivity.occurredAt.toISOString() } },
      })
    }
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
