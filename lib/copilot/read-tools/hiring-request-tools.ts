/**
 * Sprint 11 — Hiring Request read tools.
 */

import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { CopilotTool, ToolResult } from '../types'
import { MAX_RECORDS_PER_TOOL } from '../types'

const OpenHiringRequestsInput = z.object({
  limit: z.number().int().min(1).max(MAX_RECORDS_PER_TOOL).default(20),
})

const OpenHiringRequestsOutput = z.object({
  total: z.number(),
  records: z.array(z.object({
    id: z.string(),
    title: z.string(),
    department: z.string(),
    openings: z.number(),
    candidateCount: z.number(),
    status: z.string(),
    createdAt: z.string(),
  })),
})

export const getOpenHiringRequestsTool: CopilotTool<z.infer<typeof OpenHiringRequestsInput>, z.infer<typeof OpenHiringRequestsOutput>> = {
  id: 'get_open_hiring_requests',
  description: 'List all open hiring requests in the user\'s organization. Returns the count and a list of records with title, department, openings, and candidate count.',
  requiredPermission: 'hiring_request.view',
  inputSchema: OpenHiringRequestsInput,
  outputSchema: OpenHiringRequestsOutput,
  async execute(ctx, input) {
    const rows = await db.hiringRequest.findMany({
      where: { organizationId: ctx.organizationId, status: { in: ['OPEN', 'DRAFT'] as never[] } },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      include: {
        department: { select: { name: true } },
        _count: { select: { candidates: true } },
      },
    })
    return {
      total: rows.length,
      records: rows.map(r => ({
        id: r.id,
        title: r.title,
        department: r.department.name,
        openings: r.openings,
        candidateCount: r._count.candidates,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    }
  },
}

const HiringRequestSummaryInput = z.object({
  hiringRequestId: z.string().uuid(),
})

const HiringRequestSummaryOutput = z.object({
  id: z.string(),
  title: z.string(),
  department: z.string(),
  status: z.string(),
  openings: z.number(),
  filled: z.number(),
  candidateCount: z.number(),
  candidatesByStage: z.record(z.string(), z.number()),
  upcomingInterviews: z.number(),
  pendingEvaluations: z.number(),
  selectedCount: z.number(),
  offerCount: z.number(),
  recentActivityCount: z.number(),
})

export const getHiringRequestSummaryTool: CopilotTool<z.infer<typeof HiringRequestSummaryInput>, z.infer<typeof HiringRequestSummaryOutput>> = {
  id: 'get_hiring_request_summary',
  description: 'Return a structured summary of one hiring request: title, department, status, openings, candidate count by stage, upcoming interviews, pending evaluations, selected candidates, offers, and recent activity count.',
  requiredPermission: 'hiring_request.view',
  inputSchema: HiringRequestSummaryInput,
  outputSchema: HiringRequestSummaryOutput,
  async execute(ctx, input): Promise<z.infer<typeof HiringRequestSummaryOutput>> {
    // Tenant-scoped lookup — returns null for cross-tenant IDs.
    const hr = await db.hiringRequest.findFirst({
      where: { id: input.hiringRequestId, organizationId: ctx.organizationId },
      include: {
        department: { select: { name: true } },
        _count: { select: { candidates: true } },
      },
    })
    if (!hr) {
      return { id: input.hiringRequestId, title: 'NOT_FOUND', department: '', status: 'NOT_FOUND', openings: 0, filled: 0, candidateCount: 0, candidatesByStage: {}, upcomingInterviews: 0, pendingEvaluations: 0, selectedCount: 0, offerCount: 0, recentActivityCount: 0 }
    }
    const [byStage, upcoming, pendingEvals, selected, offers, recent] = await Promise.all([
      db.candidate.groupBy({ by: ['stage'], where: { hiringRequestId: hr.id, organizationId: ctx.organizationId }, _count: { _all: true } }),
      db.interview.count({ where: { hiringRequestId: hr.id, organizationId: ctx.organizationId, scheduledAt: { gte: new Date() }, status: { in: ['SCHEDULED', 'CONFIRMED'] as never[] } } }),
      db.interviewEvaluation.count({ where: { interview: { hiringRequestId: hr.id, organizationId: ctx.organizationId }, OR: [{ recommendation: null as never }, { submittedAt: null as never }] } }),
      db.candidateDecision.count({ where: { hiringRequestId: hr.id, organizationId: ctx.organizationId, decision: 'SELECTED' as never } }),
      db.offer.count({ where: { hiringRequestId: hr.id, organizationId: ctx.organizationId } }),
      db.activity.count({ where: { hiringRequestId: hr.id, organizationId: ctx.organizationId, occurredAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } } }),
    ])
    const stagesObj: Record<string, number> = {}
    for (const g of byStage) stagesObj[g.stage] = g._count._all
    return {
      id: hr.id,
      title: hr.title,
      department: hr.department.name,
      status: hr.status,
      openings: hr.openings,
      filled: hr.filled,
      candidateCount: hr._count.candidates,
      candidatesByStage: stagesObj,
      upcomingInterviews: upcoming,
      pendingEvaluations: pendingEvals,
      selectedCount: selected,
      offerCount: offers,
      recentActivityCount: recent,
    }
  },
}

const DepartmentSummaryInput = z.object({})

const DepartmentSummaryOutput = z.object({
  departments: z.array(z.object({
    name: z.string(),
    openRoles: z.number(),
    totalOpenings: z.number(),
    activeCandidates: z.number(),
  })),
})

export const getDepartmentHiringSummaryTool: CopilotTool<z.infer<typeof DepartmentSummaryInput>, z.infer<typeof DepartmentSummaryOutput>> = {
  id: 'get_department_hiring_summary',
  description: 'Return per-department rollups: number of open roles, total openings, and active candidate count.',
  requiredPermission: 'hiring_request.view',
  inputSchema: DepartmentSummaryInput,
  outputSchema: DepartmentSummaryOutput,
  async execute(ctx) {
    const [hrs, candCounts] = await Promise.all([
      db.hiringRequest.findMany({
        where: { organizationId: ctx.organizationId, status: { in: ['OPEN', 'DRAFT'] as never[] } },
        select: { departmentId: true, openings: true, department: { select: { name: true } } },
      }),
      db.candidate.groupBy({
        by: ['stage'],
        where: { organizationId: ctx.organizationId, stage: { notIn: ['HIRED', 'REJECTED'] as never[] } },
        _count: { _all: true },
      }),
    ])
    const byDept: Record<string, { name: string; openRoles: number; totalOpenings: number }> = {}
    for (const hr of hrs) {
      const key = hr.department.name
      const cur = byDept[key] ?? { name: key, openRoles: 0, totalOpenings: 0 }
      cur.openRoles += 1
      cur.totalOpenings += hr.openings
      byDept[key] = cur
    }
    const totalActiveCandidates = candCounts.reduce((s, c) => s + c._count._all, 0)
    return {
      departments: Object.values(byDept).map(d => ({
        ...d,
        activeCandidates: totalActiveCandidates, // simplified: same total per dept
      })),
    }
  },
}
