'use server'

/**
 * Sprint 8 — server actions for reading interview data.
 * Thin wrappers around the kit service + repository queries.
 */

import { revalidatePath } from 'next/cache'
import { buildInterviewKitView } from '../services/interview-kit-service'
import {
  findInterviewWithQuestions,
  listAllInterviewsForCenter,
  listInterviewsForCandidate,
  markInterviewStarted,
} from '../repositories/interview-repository'
import { kitQuestionToView } from '../mappers/interview-mappers'
import { db } from '@/lib/db'
import { requireAuth, requirePermission, recordAuditLog } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import { getEventBus } from '@/lib/events'
import type {
  ActionResult,
  CandidateInterviewListItem,
  InterviewCenterData,
  InterviewKitView,
} from '../types'

function safeRevalidate(path: string): void {
  try {
    revalidatePath(path)
  } catch {
    // ignore
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

// -----------------------------------------------------------------------------
// 1. getInterviewKitAction
// -----------------------------------------------------------------------------

export async function getInterviewKitAction(
  interviewId: string
): Promise<ActionResult<InterviewKitView>> {
  // Sprint 9 PART 13: interview.view. Tenant-scoped.
  const auth = await requirePermission('interview.view')
  if (!auth.ok) return toActionFailure(auth)
  // PART 11: INTERVIEWER can only see interviews where they participate.
  // Admin/TA_LEAD/Recruiter/HM/Viewer can see all in the org.
  const orgId = auth.data.organizationId
  if (auth.data.role === 'INTERVIEWER') {
    const participant = await db.interviewParticipant.findFirst({
      where: { interviewId, userId: auth.data.userId },
      select: { id: true },
    })
    if (!participant) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }
  } else {
    const interview = await db.interview.findFirst({
      where: { id: interviewId, organizationId: orgId },
      select: { id: true },
    })
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }
  }
  return buildInterviewKitView(interviewId)
}

// -----------------------------------------------------------------------------
// 2. getCandidateInterviewsAction
// -----------------------------------------------------------------------------

export async function getCandidateInterviewsAction(
  candidateId: string
): Promise<ActionResult<{ items: CandidateInterviewListItem[] }>> {
  try {
    // Sprint 9 PART 13: candidate.view. Tenant-scoped. PART 11: INTERVIEWER
    // can only see interviews where they participate.
    const auth = await requirePermission('candidate.view')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId
    const candidate = await db.candidate.findFirst({ where: { id: candidateId, organizationId: orgId }, select: { id: true } })
    if (!candidate) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Candidate not found.', retryable: false } }
    }
    let rows = await listInterviewsForCandidate(candidateId)
    if (auth.data.role === 'INTERVIEWER') {
      const userId = auth.data.userId
      rows = rows.filter(r => r.participants.some(p => p.userId === userId))
    }
    const items: CandidateInterviewListItem[] = rows.map(r => {
      const evalRow = r.evaluations[0]
      return {
        id: r.id,
        candidateId: r.candidateId,
        type: r.type,
        title: r.title,
        status: r.status,
        scheduledAt: r.scheduledAt.toISOString(),
        durationMinutes: r.durationMinutes,
        round: r.round,
        participantNames: r.participants.map(p => `${p.user.firstName} ${p.user.lastName}`),
        hasEvaluation: !!evalRow,
        interviewScore: evalRow?.interviewScore ?? null,
        evaluationRecommendation: evalRow?.recommendation ?? null,
      }
    })
    return { ok: true, data: { items } }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to load candidate interviews.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

// -----------------------------------------------------------------------------
// 3. getInterviewCenterAction
// -----------------------------------------------------------------------------

export async function getInterviewCenterAction(): Promise<ActionResult<InterviewCenterData>> {
  try {
    // Sprint 9 PART 13: interview.view. Tenant-scoped. PART 11: INTERVIEWER
    // sees only their own interviews.
    const auth = await requirePermission('interview.view')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

    const allRows = await listAllInterviewsForCenter()
    // Sprint 9 PART 6: tenant scope. PART 11: INTERVIEWER sees only their
    // own interviews. PART 21: do not leak that an interview exists in
    // another org.
    const rows = allRows
      .filter(r => r.organizationId === orgId)
      .filter(r => auth.data.role === 'INTERVIEWER' ? r.participants.some(p => p.userId === auth.data.userId) : true)

    const toItem = (r: typeof rows[number]): CandidateInterviewListItem => {
      const e = r.evaluations[0]
      return {
        id: r.id,
        candidateId: r.candidateId,
        type: r.type,
        title: `${r.candidate.firstName} ${r.candidate.lastName} — ${r.hiringRequest.title}`,
        status: r.status,
        scheduledAt: r.scheduledAt.toISOString(),
        durationMinutes: r.durationMinutes,
        round: r.round,
        participantNames: r.participants.map(p => `${p.user.firstName} ${p.user.lastName}`),
        hasEvaluation: !!e,
        interviewScore: e?.interviewScore ?? null,
        evaluationRecommendation: e?.recommendation ?? null,
      }
    }

    const items = rows.map(toItem)
    const today = items.filter(i => {
      const d = new Date(i.scheduledAt)
      return d >= startOfDay && d <= endOfDay
    })
    const upcoming = items.filter(i => new Date(i.scheduledAt) > endOfDay && i.status !== 'COMPLETED' && i.status !== 'CANCELLED')
    const past = items.filter(i => new Date(i.scheduledAt) < startOfDay)
    const completed = items.filter(i => i.status === 'COMPLETED')
    const all = items

    return {
      ok: true,
      data: {
        today,
        upcoming,
        past,
        completed,
        all,
        counts: {
          today: today.length,
          upcoming: upcoming.length,
          past: past.length,
          completed: completed.length,
          all: all.length,
        },
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to load interview center.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

// -----------------------------------------------------------------------------
// 4. markInterviewStartedAction (separate file re-export kept for back-compat)
// -----------------------------------------------------------------------------

export async function startInterviewAction(
  interviewId: string
): Promise<ActionResult<{ startedAt: string }>> {
  const bus = getEventBus()
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
    await markInterviewStarted(interview.id, startedAt)
    bus.publish({
      type: 'InterviewStarted',
      payload: {
        interviewId: interview.id,
        candidateId: interview.candidateId,
        startedAt: startedAt.toISOString(),
      },
    })
    safeRevalidate(`/candidates/${interview.candidateId}/interview-kit/${interview.id}`)
    return { ok: true, data: { startedAt: startedAt.toISOString() } }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: 'Failed to start interview.', retryable: true, details: err instanceof Error ? err.message : String(err) } }
  }
}


