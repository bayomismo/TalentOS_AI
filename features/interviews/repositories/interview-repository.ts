/**
 * Sprint 8 — Interview repository.
 *
 * All Prisma access for the Interview + InterviewQuestion + InterviewParticipant
 * models lives here. Server actions call into these — they never touch Prisma
 * directly. This keeps the data-access shape testable and the action files
 * thin.
 */

import { db } from '@/lib/db'
import type { InterviewType, InterviewStatus } from '@prisma/client'
import type { InterviewKitOutput } from '@/lib/ai/schemas/interview-kit.schema'
import { purposeToQuestionType } from '../mappers/interview-mappers'
import { extractQuestionMeta } from '@/lib/ai/schemas/interview-kit.schema'

// -----------------------------------------------------------------------------
// Read helpers
// -----------------------------------------------------------------------------

export async function findInterviewWithQuestions(interviewId: string) {
  return db.interview.findUnique({
    where: { id: interviewId },
    include: {
      candidate: { include: { skills: true } },
      hiringRequest: { include: { jobDescription: true } },
      participants: { include: { user: { select: { firstName: true, lastName: true } } } },
      questions: { orderBy: { order: 'asc' } },
      evaluations: { orderBy: { submittedAt: 'desc' }, take: 1 },
    },
  })
}

export async function findOpenInterviewForCandidate(candidateId: string) {
  return db.interview.findFirst({
    where: { candidateId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
    include: { questions: true },
    orderBy: { scheduledAt: 'desc' },
  })
}

export async function listInterviewsForCandidate(candidateId: string) {
  return db.interview.findMany({
    where: { candidateId },
    include: {
      participants: { include: { user: { select: { firstName: true, lastName: true } } } },
      evaluations: {
        select: { id: true, interviewScore: true, recommendation: true },
        orderBy: { submittedAt: 'desc' },
        take: 1,
      },
      reminderToken: { select: { token: true } },
    },
    orderBy: { scheduledAt: 'desc' },
  })
}

/**
 * Audit P2-21 — the Interview Center used to call
 * `db.interview.findMany()` with NO `where` clause: every interview of
 * every tenant was pulled into the server process, with participants and
 * evaluation scores, and the tenant filter was then applied in
 * application code.
 *
 * The OUTPUT was always correctly scoped (it was a hygiene/perf smell,
 * not a live disclosure), but the cross-tenant rows should never have
 * been read in the first place. The filter now lives in the query:
 *
 *   - `organizationId` — the caller's tenant.
 *   - `participants: { some: { userId } }` — the PART 11 resource scope
 *     for an INTERVIEWER, who only sees the interviews they are on.
 */
export interface ListInterviewsForCenterParams {
  organizationId: string
  /** Restrict to interviews the given user participates in (PART 11). */
  participantUserId?: string | null
}

export async function listInterviewsForCenter(params: ListInterviewsForCenterParams) {
  return db.interview.findMany({
    where: {
      organizationId: params.organizationId,
      ...(params.participantUserId
        ? { participants: { some: { userId: params.participantUserId } } }
        : {}),
    },
    include: {
      candidate: { select: { firstName: true, lastName: true } },
      hiringRequest: { select: { title: true } },
      participants: { include: { user: { select: { firstName: true, lastName: true } } } },
      evaluations: {
        select: { interviewScore: true, recommendation: true },
        orderBy: { submittedAt: 'desc' },
        take: 1,
      },
      // Sprint 17 — pull the reminder token so the UI can offer a
      // "Add to calendar" link for each interview.
      reminderToken: { select: { token: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  })
}

export async function findInterviewQuestion(questionId: string) {
  return db.interviewQuestion.findUnique({
    where: { id: questionId },
    select: { id: true, askedAt: true },
  })
}

// -----------------------------------------------------------------------------
// Write helpers
// -----------------------------------------------------------------------------

export interface CreateInterviewInput {
  organizationId: string
  hiringRequestId: string
  candidateId: string
  scheduledById: string
  type: InterviewType
  title: string
  scheduledAt: Date
  durationMinutes: number
  notes?: string
  stage: 'INTERVIEW'
  round: number
  kitSnapshot: InterviewKitOutput | unknown
}

export async function createInterview(data: CreateInterviewInput) {
  return db.interview.create({
    data: {
      organizationId: data.organizationId,
      hiringRequestId: data.hiringRequestId,
      candidateId: data.candidateId,
      scheduledById: data.scheduledById,
      type: data.type,
      title: data.title,
      status: 'SCHEDULED',
      scheduledAt: data.scheduledAt,
      durationMinutes: data.durationMinutes,
      notes: data.notes,
      stage: data.stage,
      round: data.round,
      kitSnapshot: data.kitSnapshot as object,
    },
    include: { questions: true },
  })
}

export async function updateInterviewKit(
  interviewId: string,
  data: { type: InterviewType; durationMinutes: number; scheduledAt?: Date; kitSnapshot: unknown }
) {
  return db.interview.update({
    where: { id: interviewId },
    data: {
      type: data.type,
      durationMinutes: data.durationMinutes,
      // Sprint 19 (audit P2-19) — the slot only moves when the caller
      // explicitly asks for a new time. Regenerating the AI kit must not
      // reschedule the interview.
      ...(data.scheduledAt ? { scheduledAt: data.scheduledAt } : {}),
      kitSnapshot: data.kitSnapshot as object,
    },
    include: { questions: true },
  })
}

export async function deleteAllQuestionsForInterview(interviewId: string) {
  return db.interviewQuestion.deleteMany({ where: { interviewId } })
}

export async function bulkInsertQuestions(
  interviewId: string,
  kit: InterviewKitOutput
) {
  return db.interviewQuestion.createMany({
    data: kit.questions.map((q, i) => {
      const meta = extractQuestionMeta(q.guidance.strongAnswer)
      return {
        interviewId,
        category: q.category,
        type: purposeToQuestionType(q.purpose),
        purpose: q.purpose,
        difficulty: meta.difficulty,
        question: q.question,
        whyThisQuestion: q.whyThisQuestion,
        strongAnswerIndicators: q.guidance.strongAnswer,
        redFlags: q.guidance.redFlags,
        suggestedFollowUp: meta.suggestedFollowUp,
        order: i,
      }
    }),
  })
}

export async function findExistingParticipants(
  interviewId: string
): Promise<Array<{ userId: string; role: string | null }>> {
  const rows = await db.interviewParticipant.findMany({
    where: { interviewId },
    select: { userId: true, role: true },
  })
  return rows
}

export async function upsertParticipant(
  interviewId: string,
  userId: string,
  role: string
) {
  return db.interviewParticipant.upsert({
    where: { interviewId_userId: { interviewId, userId } },
    update: { role },
    create: { interviewId, userId, role },
  })
}

export async function markInterviewQuestionAsked(
  questionId: string,
  askedAt: Date | null,
  notes: string | undefined
) {
  return db.interviewQuestion.update({
    where: { id: questionId },
    data: {
      askedAt,
      notes: notes !== undefined ? notes : undefined,
    },
  })
}

/**
 * Audit P1-05 — a tenant-scoped fetch of one interview, WITH the
 * foreign-key tenant filters.
 *
 * `organizationId` on the interview row alone is not enough: the
 * interview points at a candidate and a hiring request, and both carry
 * their own `organizationId`. A row whose parent belongs to another
 * tenant is a data-integrity problem, and the caller must not act on it.
 *
 * The query therefore asserts that the interview, its candidate and its
 * hiring request all belong to `organizationId`.
 */
export async function findInterviewForOrg(
  interviewId: string,
  organizationId: string
) {
  return db.interview.findFirst({
    where: {
      id: interviewId,
      organizationId,
      candidate: { organizationId },
      hiringRequest: { organizationId },
    },
    include: {
      candidate: { select: { id: true, organizationId: true, firstName: true, lastName: true } },
      hiringRequest: { select: { id: true, organizationId: true } },
      participants: { select: { userId: true } },
    },
  })
}
