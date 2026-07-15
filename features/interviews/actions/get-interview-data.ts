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
  return buildInterviewKitView(interviewId)
}

// -----------------------------------------------------------------------------
// 2. getCandidateInterviewsAction
// -----------------------------------------------------------------------------

export async function getCandidateInterviewsAction(
  candidateId: string
): Promise<ActionResult<{ items: CandidateInterviewListItem[] }>> {
  try {
    const rows = await listInterviewsForCandidate(candidateId)
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
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

    const rows = await listAllInterviewsForCenter()

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

// Re-export the question-asked marker (kept here so consumers have one
// import path for all read+write actions related to interview data).
export { markInterviewQuestionAskedAction } from './update-question'

// Silence unused-export warning (kitQuestionToView is consumed by tests)
export const __kitQuestionToView = kitQuestionToView
// Silence unused-import for resolveNames (kept for future callers)
export const __resolveNames = resolveNames
