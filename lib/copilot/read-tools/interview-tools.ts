/**
 * Sprint 11 — Interview read tools.
 */

import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { CopilotTool } from '../types'
import { MAX_RECORDS_PER_TOOL } from '../types'

const UpcomingInterviewsInput = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  hiringRequestId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(MAX_RECORDS_PER_TOOL).default(50),
})

const UpcomingInterviewsOutput = z.object({
  total: z.number(),
  records: z.array(z.object({
    interviewId: z.string(),
    candidateId: z.string(),
    candidateName: z.string(),
    hiringRequestId: z.string(),
    hiringRequestTitle: z.string(),
    scheduledAt: z.string().nullable(),
    status: z.string(),
    participantCount: z.number(),
    hasEvaluation: z.boolean(),
  })),
})

export const getUpcomingInterviewsTool: CopilotTool<z.infer<typeof UpcomingInterviewsInput>, z.infer<typeof UpcomingInterviewsOutput>> = {
  id: 'get_upcoming_interviews',
  description: 'List upcoming interviews (SCHEDULED or CONFIRMED) in the user\'s organization, optionally filtered by date range or hiring request. Returns candidate, scheduled date, status, participants, and evaluation status.',
  requiredPermission: 'interview.view',
  inputSchema: UpcomingInterviewsInput,
  outputSchema: UpcomingInterviewsOutput,
  async execute(ctx, input) {
    const where: any = { organizationId: ctx.organizationId, status: { in: ['SCHEDULED', 'CONFIRMED'] as never[] } }
    if (input.hiringRequestId) where.hiringRequestId = input.hiringRequestId
    if (input.fromDate || input.toDate) {
      where.scheduledAt = {}
      if (input.fromDate) where.scheduledAt.gte = new Date(input.fromDate)
      if (input.toDate) where.scheduledAt.lte = new Date(input.toDate)
    }
    if (!input.fromDate && !input.toDate) {
      where.scheduledAt = { gte: new Date() }
    }
    const rows = await db.interview.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      take: input.limit,
      include: {
        candidate: { select: { id: true, firstName: true, lastName: true } },
        hiringRequest: { select: { id: true, title: true } },
        _count: { select: { participants: true } },
        evaluations: { select: { id: true } },
      },
    })
    return {
      total: rows.length,
      records: rows.map(r => ({
        interviewId: r.id,
        candidateId: r.candidate.id,
        candidateName: `${r.candidate.firstName} ${r.candidate.lastName}`.trim(),
        hiringRequestId: r.hiringRequest.id,
        hiringRequestTitle: r.hiringRequest.title,
        scheduledAt: r.scheduledAt?.toISOString() ?? null,
        status: r.status,
        participantCount: r._count.participants,
        hasEvaluation: r.evaluations.length > 0,
      })),
    }
  },
}

const MyUpcomingInterviewsInput = z.object({
  limit: z.number().int().min(1).max(MAX_RECORDS_PER_TOOL).default(50),
})

const MyUpcomingInterviewsOutput = UpcomingInterviewsOutput

export const getMyUpcomingInterviewsTool: CopilotTool<z.infer<typeof MyUpcomingInterviewsInput>, z.infer<typeof MyUpcomingInterviewsOutput>> = {
  id: 'get_my_upcoming_interviews',
  description: 'List upcoming interviews where the current user is a participant. INTERVIEWER-focused. Returns only the user\'s authorized interviews.',
  requiredPermission: 'interview.view',
  inputSchema: MyUpcomingInterviewsInput,
  outputSchema: MyUpcomingInterviewsOutput,
  async execute(ctx, input) {
    const rows = await db.interview.findMany({
      where: {
        organizationId: ctx.organizationId,
        status: { in: ['SCHEDULED', 'CONFIRMED'] as never[] },
        scheduledAt: { gte: new Date() },
        participants: { some: { userId: ctx.userId } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: input.limit,
      include: {
        candidate: { select: { id: true, firstName: true, lastName: true } },
        hiringRequest: { select: { id: true, title: true } },
        _count: { select: { participants: true } },
        evaluations: { select: { id: true, submittedAt: true, evaluatorId: true } },
      },
    })
    return {
      total: rows.length,
      records: rows.map(r => ({
        interviewId: r.id,
        candidateId: r.candidate.id,
        candidateName: `${r.candidate.firstName} ${r.candidate.lastName}`.trim(),
        hiringRequestId: r.hiringRequest.id,
        hiringRequestTitle: r.hiringRequest.title,
        scheduledAt: r.scheduledAt?.toISOString() ?? null,
        status: r.status,
        participantCount: r._count.participants,
        hasEvaluation: r.evaluations.some(e => e.evaluatorId === ctx.userId && e.submittedAt),
      })),
    }
  },
}

const MyPendingEvaluationsInput = z.object({
  limit: z.number().int().min(1).max(MAX_RECORDS_PER_TOOL).default(50),
})

const MyPendingEvaluationsOutput = z.object({
  total: z.number(),
  records: z.array(z.object({
    interviewId: z.string(),
    candidateId: z.string(),
    candidateName: z.string(),
    hiringRequestTitle: z.string(),
    completedAt: z.string().nullable(),
  })),
})

export const getMyPendingEvaluationsTool: CopilotTool<z.infer<typeof MyPendingEvaluationsInput>, z.infer<typeof MyPendingEvaluationsOutput>> = {
  id: 'get_my_pending_evaluations',
  description: 'List completed interviews where the current user is a participant but has not yet submitted their own evaluation. INTERVIEWER-focused.',
  requiredPermission: 'interview.view',
  inputSchema: MyPendingEvaluationsInput,
  outputSchema: MyPendingEvaluationsOutput,
  async execute(ctx, input) {
    // Find all completed interviews where the user is a participant
    const rows = await db.interview.findMany({
      where: {
        organizationId: ctx.organizationId,
        status: 'COMPLETED' as never,
        participants: { some: { userId: ctx.userId } },
      },
      orderBy: { scheduledAt: 'desc' },
      take: input.limit,
      include: {
        candidate: { select: { id: true, firstName: true, lastName: true } },
        hiringRequest: { select: { title: true } },
        evaluations: { where: { evaluatorId: ctx.userId }, select: { id: true, submittedAt: true } },
      },
    })
    // Filter to interviews that don't yet have a submitted evaluation from this user
    const pending = rows.filter(r => !r.evaluations.some((e: any) => e.submittedAt))
    return {
      total: pending.length,
      records: pending.map(r => ({
        interviewId: r.id,
        candidateId: r.candidate.id,
        candidateName: `${r.candidate.firstName} ${r.candidate.lastName}`.trim(),
        hiringRequestTitle: r.hiringRequest.title,
        completedAt: r.scheduledAt?.toISOString() ?? null,
      })),
    }
  },
}
