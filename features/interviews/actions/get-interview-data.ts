'use server'

/**
 * Sprint 8 — server actions for reading interview data.
 * Thin wrappers around the kit service + repository queries.
 */

import { revalidatePath } from 'next/cache'
import { buildInterviewKitView } from '../services/interview-kit-service'
import {
  findInterviewForOrg,
  findInterviewWithQuestions,
  listInterviewsForCandidate,
  listInterviewsForCenter,
} from '../repositories/interview-repository'
import { findEvaluationsForInterview } from '../repositories/evaluation-repository'
import { kitQuestionToView } from '../mappers/interview-mappers'
import { db } from '@/lib/db'
import { requireAuth, requirePermission, recordAuditLog } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import { getEventBus } from '@/lib/events'
import { transitionInterviewStatus } from '@/lib/interviews/transition'
import { InterviewStatus } from '@prisma/client'
import type {
  ActionResult,
  CandidateInterviewListItem,
  InterviewCenterData,
  InterviewEvaluationView,
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
        reminderToken: r.reminderToken?.token ?? null,
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

    const allRows = await listInterviewsForCenter({
      organizationId: orgId,
      // PART 11: an INTERVIEWER only sees the interviews they are on.
      // The scope is applied IN THE QUERY (audit P2-21) — the previous
      // implementation read every tenant's interviews and filtered them
      // in memory.
      participantUserId: auth.data.role === 'INTERVIEWER' ? auth.data.userId : null,
    })
    const rows = allRows

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
        // Sprint 17: existing token or null (cron will create one when it
        // sends the reminder). Read it from the relation.
        reminderToken: r.reminderToken?.token ?? null,
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
// 5. getInterviewEvaluationsAction — read back a submitted evaluation
// -----------------------------------------------------------------------------

/**
 * Audit P1-07 — submitted evaluations were WRITE-ONLY.
 *
 * An interviewer could not read back what they had submitted, so a typo
 * in a score was permanent. This action returns the evaluations of one
 * interview: the caller's own evaluation always, and the rest of the
 * panel's for a caller who is allowed to see them.
 */
export async function getInterviewEvaluationsAction(
  interviewId: string
): Promise<ActionResult<{ evaluations: InterviewEvaluationView[]; mine: InterviewEvaluationView | null }>> {
  try {
    const auth = await requirePermission('interview.view')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    const interview = await findInterviewForOrg(interviewId, orgId)
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }
    const isParticipant = interview.participants.some(p => p.userId === auth.data.userId)
    if (auth.data.role === 'INTERVIEWER' && !isParticipant) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }

    const rows = await findEvaluationsForInterview(interviewId)
    const evaluations: InterviewEvaluationView[] = rows.map(e => ({
      id: e.id,
      evaluatorId: e.evaluatorId,
      evaluatorName: `${e.evaluator.firstName} ${e.evaluator.lastName}`,
      overallScore: e.overallScore,
      interviewScore: e.interviewScore,
      recommendation: e.recommendation,
      strengths: e.strengths,
      concerns: e.weaknesses,
      overallNotes: e.overallNotes,
      criterionScores: (e.criterionScores as Record<string, number> | null) ?? null,
      submittedAt: e.submittedAt.toISOString(),
      isMine: e.evaluatorId === auth.data.userId,
    }))

    return {
      ok: true,
      data: {
        evaluations,
        mine: evaluations.find(e => e.isMine) ?? null,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to load evaluations.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

// -----------------------------------------------------------------------------
// 4. startInterviewAction — start the interview session
// -----------------------------------------------------------------------------

/**
 * Audit P1-05 (SECURITY — confirmed live cross-tenant write).
 *
 * The previous implementation was:
 *
 *   const interview = await db.interview.findUnique({ where: { id: interviewId }, ... })
 *
 * — no `requirePermission`, no `organizationId` filter. Any authenticated
 * user in any tenant could mutate any interview's state by guessing or
 * harvesting an id. The audit-6 gate proved it: calling this against
 * another organization's interview returned `ok=true` and wrote
 * `startedAt`.
 *
 * The guard is now, in order:
 *
 *   1. `requirePermission('interview.schedule')` — the RBAC matrix, not
 *      a hand-rolled role list. VIEWER and INTERVIEWER do not hold it.
 *   2. A tenant-scoped read that ALSO filters the foreign keys
 *      (`candidate.organizationId`, `hiringRequest.organizationId`), so a
 *      row whose parents live in another tenant is never acted on.
 *   3. The PART 11 resource scope: an INTERVIEWER may only start an
 *      interview they participate in.
 *   4. The interview state machine: SCHEDULED → IN_PROGRESS. An
 *      interview that was cancelled, completed or marked as a no-show
 *      cannot be started.
 *
 * The action is idempotent: an interview that is already IN_PROGRESS
 * returns its existing `startedAt` instead of writing again.
 */
export async function startInterviewAction(
  interviewId: string
): Promise<ActionResult<{ startedAt: string }>> {
  const bus = getEventBus()
  try {
    const auth = await requirePermission('interview.schedule')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    const interview = await findInterviewForOrg(interviewId, orgId)
    if (!interview) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }
    if (
      auth.data.role === 'INTERVIEWER' &&
      !interview.participants.some(p => p.userId === auth.data.userId)
    ) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Interview not found.', retryable: false } }
    }
    if (interview.startedAt) {
      return { ok: true, data: { startedAt: interview.startedAt.toISOString() } }
    }

    const startedAt = new Date()
    const transition = await db.$transaction(async (tx) =>
      transitionInterviewStatus(tx, {
        interviewId: interview.id,
        toStatus: InterviewStatus.IN_PROGRESS,
        startedAt,
      }),
    )
    if (!transition.ok) {
      return { ok: false, error: { code: transition.error.code, message: transition.error.message, retryable: false } }
    }

    bus.publish({
      type: 'InterviewStarted',
      payload: {
        interviewId: interview.id,
        candidateId: interview.candidateId,
        startedAt: startedAt.toISOString(),
      },
    })
    safeRevalidate(`/candidates/${interview.candidateId}/interview-kit/${interview.id}`)
    safeRevalidate('/interview-center')
    return { ok: true, data: { startedAt: startedAt.toISOString() } }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: 'Failed to start interview.', retryable: true, details: err instanceof Error ? err.message : String(err) } }
  }
}


