/**
 * Sprint 11 — Pipeline + activity summary tools.
 */

import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { CopilotTool } from '../types'

const PipelineSummaryInput = z.object({})

const PipelineSummaryOutput = z.object({
  openHiringRequests: z.number(),
  totalCandidates: z.number(),
  candidatesByStage: z.record(z.string(), z.number()),
  upcomingInterviews: z.number(),
  pendingEvaluations: z.number(),
  offersInFlight: z.number(),
  acceptedOffers: z.number(),
  declinedOffers: z.number(),
})

export const getHiringPipelineSummaryTool: CopilotTool<z.infer<typeof PipelineSummaryInput>, z.infer<typeof PipelineSummaryOutput>> = {
  id: 'get_hiring_pipeline_summary',
  description: 'Return organization-wide pipeline counts: open hiring requests, total candidates, candidates by stage, upcoming interviews, pending evaluations, and offer counts by status.',
  requiredPermission: 'hiring_request.view',
  inputSchema: PipelineSummaryInput,
  outputSchema: PipelineSummaryOutput,
  async execute(ctx) {
    const orgId = ctx.organizationId
    const [openHR, totalCand, byStage, upcoming, pending, offers] = await Promise.all([
      db.hiringRequest.count({ where: { organizationId: orgId, status: { in: ['OPEN', 'DRAFT'] as never[] } } }),
      db.candidate.count({ where: { organizationId: orgId } }),
      db.candidate.groupBy({ by: ['stage'], where: { organizationId: orgId }, _count: { _all: true } }),
      db.interview.count({ where: { organizationId: orgId, status: { in: ['SCHEDULED', 'CONFIRMED'] as never[] }, scheduledAt: { gte: new Date() } } }),
      db.interviewEvaluation.count({ where: { interview: { organizationId: orgId }, submittedAt: { equals: null as never } } }),
      db.offer.groupBy({ by: ['status'], where: { organizationId: orgId }, _count: { _all: true } }),
    ])
    const byStageObj: Record<string, number> = {}
    for (const g of byStage) byStageObj[g.stage] = g._count._all
    const byOfferStatus: Record<string, number> = {}
    for (const g of offers) byOfferStatus[g.status] = g._count._all
    return {
      openHiringRequests: openHR,
      totalCandidates: totalCand,
      candidatesByStage: byStageObj,
      upcomingInterviews: upcoming,
      pendingEvaluations: pending,
      offersInFlight: (byOfferStatus['DRAFT'] ?? 0) + (byOfferStatus['PENDING_APPROVAL'] ?? 0) + (byOfferStatus['APPROVED'] ?? 0) + (byOfferStatus['ISSUED'] ?? 0),
      acceptedOffers: byOfferStatus['ACCEPTED'] ?? 0,
      declinedOffers: byOfferStatus['DECLINED'] ?? 0,
    }
  },
}

const RecentActivityInput = z.object({
  days: z.number().int().min(1).max(90).default(14),
  limit: z.number().int().min(1).max(50).default(15),
})

const RecentActivityOutput = z.object({
  total: z.number(),
  records: z.array(z.object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    candidateId: z.string().nullable(),
    candidateName: z.string().nullable(),
    hiringRequestId: z.string().nullable(),
    occurredAt: z.string(),
  })),
})

export const getRecentHiringActivityTool: CopilotTool<z.infer<typeof RecentActivityInput>, z.infer<typeof RecentActivityOutput>> = {
  id: 'get_recent_hiring_activity',
  description: 'List recent hiring activity events in the user\'s organization. Returns type, title, candidate, hiring request, and timestamp.',
  requiredPermission: 'reports.view',
  inputSchema: RecentActivityInput,
  outputSchema: RecentActivityOutput,
  async execute(ctx, input) {
    const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000)
    const rows = await db.activity.findMany({
      where: { organizationId: ctx.organizationId, occurredAt: { gte: since } },
      orderBy: { occurredAt: 'desc' },
      take: input.limit,
      include: {
        candidate: { select: { id: true, firstName: true, lastName: true } },
        hiringRequest: { select: { id: true, title: true } },
      },
    })
    return {
      total: rows.length,
      records: rows.map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        candidateId: r.candidate?.id ?? null,
        candidateName: r.candidate ? `${r.candidate.firstName} ${r.candidate.lastName}`.trim() : null,
        hiringRequestId: r.hiringRequest?.id ?? null,
        occurredAt: r.occurredAt.toISOString(),
      })),
    }
  },
}

const HRNoCandidatesInput = z.object({
  limit: z.number().int().min(1).max(50).default(20),
})

const HRNoCandidatesOutput = z.object({
  total: z.number(),
  records: z.array(z.object({
    id: z.string(),
    title: z.string(),
    department: z.string(),
    openings: z.number(),
    createdAt: z.string(),
    daysOpen: z.number(),
  })),
})

export const getHiringRequestsWithNoCandidatesTool: CopilotTool<z.infer<typeof HRNoCandidatesInput>, z.infer<typeof HRNoCandidatesOutput>> = {
  id: 'get_hiring_requests_with_no_candidates',
  description: 'List open hiring requests that have no candidates. Useful for "which hiring requests are empty?" questions.',
  requiredPermission: 'hiring_request.view',
  inputSchema: HRNoCandidatesInput,
  outputSchema: HRNoCandidatesOutput,
  async execute(ctx, input) {
    const rows = await db.hiringRequest.findMany({
      where: {
        organizationId: ctx.organizationId,
        status: { in: ['OPEN', 'DRAFT'] as never[] },
        candidates: { none: {} },
      },
      orderBy: { createdAt: 'asc' },
      take: input.limit,
      include: { department: { select: { name: true } } },
    })
    return {
      total: rows.length,
      records: rows.map(r => ({
        id: r.id,
        title: r.title,
        department: r.department.name,
        openings: r.openings,
        createdAt: r.createdAt.toISOString(),
        daysOpen: Math.floor((Date.now() - r.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      })),
    }
  },
}
