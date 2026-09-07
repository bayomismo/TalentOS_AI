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

export async function listAllInterviewsForCenter() {
  return db.interview.findMany({
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
  data: { type: InterviewType; durationMinutes: number; scheduledAt: Date; kitSnapshot: unknown }
) {
  return db.interview.update({
    where: { id: interviewId },
    data: {
      type: data.type,
      durationMinutes: data.durationMinutes,
      scheduledAt: data.scheduledAt,
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

export async function markInterviewStarted(interviewId: string, startedAt: Date) {
  return db.interview.update({
    where: { id: interviewId },
    data: { startedAt, status: 'IN_PROGRESS' },
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

export async function markInterviewCompleted(interviewId: string) {
  return db.interview.update({
    where: { id: interviewId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  })
}
