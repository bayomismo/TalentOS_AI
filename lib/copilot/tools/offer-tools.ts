/**
 * Sprint 11 — Offer read tools.
 *
 * PART 17 + PART 23: compensation privacy is enforced at the projection
 * layer. Tools that return salary-related fields check
 * `ctx.hasPermission('offer.view_compensation')` and omit them
 * otherwise.
 */

import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { CopilotTool } from '../types'
import { MAX_RECORDS_PER_TOOL } from '../types'

const OffersByStatusInput = z.object({
  statuses: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(MAX_RECORDS_PER_TOOL).default(50),
})

const OffersByStatusOutput = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
  records: z.array(z.object({
    id: z.string(),
    status: z.string(),
    title: z.string(),
    candidateId: z.string(),
    candidateName: z.string(),
    hiringRequestId: z.string(),
    hiringRequestTitle: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    expiresAt: z.string().nullable(),
    createdByName: z.string().nullable(),
    salaryAmount: z.number().optional(),
    salaryCurrency: z.string().optional(),
    salaryPeriod: z.string().optional(),
  })),
})

export const getOffersByStatusTool: CopilotTool<z.infer<typeof OffersByStatusInput>, z.infer<typeof OffersByStatusOutput>> = {
  id: 'get_offers_by_status',
  description: 'List offers in the user\'s organization, optionally filtered by status. Returns count per status and a record list. Compensation is ONLY included when the caller has offer.view_compensation.',
  requiredPermission: 'offer.view',
  inputSchema: OffersByStatusInput,
  outputSchema: OffersByStatusOutput,
  async execute(ctx, input) {
    const where: any = { organizationId: ctx.organizationId }
    if (input.statuses && input.statuses.length > 0) where.status = { in: input.statuses }
    const [groups, rows] = await Promise.all([
      db.offer.groupBy({ by: ['status'], where: { organizationId: ctx.organizationId }, _count: { _all: true } }),
      db.offer.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: input.limit,
        include: {
          candidate: { select: { firstName: true, lastName: true } },
          hiringRequest: { select: { title: true } },
          createdBy: { select: { firstName: true, lastName: true } },
        },
      }),
    ])
    const byStatus: Record<string, number> = {}
    for (const g of groups) byStatus[g.status] = g._count._all
    const includeComp = ctx.hasPermission('offer.view_compensation')
    return {
      total: rows.length,
      byStatus,
      records: rows.map(r => {
        const base: any = {
          id: r.id,
          status: r.status,
          title: r.title,
          candidateId: r.candidateId,
          candidateName: `${r.candidate.firstName} ${r.candidate.lastName}`.trim(),
          hiringRequestId: r.hiringRequestId,
          hiringRequestTitle: r.hiringRequest.title,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          expiresAt: r.expiresAt?.toISOString() ?? null,
          createdByName: r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim() : null,
        }
        if (includeComp) {
          base.salaryAmount = r.salaryAmount
          base.salaryCurrency = r.salaryCurrency
          base.salaryPeriod = r.salaryPeriod
        }
        return base
      }),
    }
  },
}

const OffersPendingApprovalOutput = z.object({
  total: z.number(),
  records: z.array(z.object({
    id: z.string(),
    title: z.string(),
    candidateId: z.string(),
    candidateName: z.string(),
    hiringRequestId: z.string(),
    hiringRequestTitle: z.string(),
    createdAt: z.string(),
  })),
})

export const getOffersPendingApprovalTool: CopilotTool<{ limit?: number }, z.infer<typeof OffersPendingApprovalOutput>> = {
  id: 'get_offers_pending_approval',
  description: 'List offers in PENDING_APPROVAL status. Returns basic facts (no compensation) suitable for "which offers need approval?" questions.',
  requiredPermission: 'offer.view',
  inputSchema: z.object({ limit: z.number().int().min(1).max(MAX_RECORDS_PER_TOOL).default(50) }),
  outputSchema: OffersPendingApprovalOutput,
  async execute(ctx, input) {
    const rows = await db.offer.findMany({
      where: { organizationId: ctx.organizationId, status: 'PENDING_APPROVAL' as never },
      orderBy: { createdAt: 'asc' },
      take: input.limit ?? 50,
      include: {
        candidate: { select: { firstName: true, lastName: true } },
        hiringRequest: { select: { title: true } },
      },
    })
    return {
      total: rows.length,
      records: rows.map(r => ({
        id: r.id,
        title: r.title,
        candidateId: r.candidateId,
        candidateName: `${r.candidate.firstName} ${r.candidate.lastName}`.trim(),
        hiringRequestId: r.hiringRequestId,
        hiringRequestTitle: r.hiringRequest.title,
        createdAt: r.createdAt.toISOString(),
      })),
    }
  },
}

const OffersExpiringSoonInput = z.object({
  withinDays: z.number().int().min(1).max(60).default(7),
})

const OffersExpiringSoonOutput = z.object({
  total: z.number(),
  records: z.array(z.object({
    id: z.string(),
    status: z.string(),
    title: z.string(),
    candidateId: z.string(),
    candidateName: z.string(),
    hiringRequestId: z.string(),
    hiringRequestTitle: z.string(),
    expiresAt: z.string().nullable(),
    daysRemaining: z.number().nullable(),
  })),
})

export const getOffersExpiringSoonTool: CopilotTool<z.infer<typeof OffersExpiringSoonInput>, z.infer<typeof OffersExpiringSoonOutput>> = {
  id: 'get_offers_expiring_soon',
  description: 'List ISSUED offers that expire within the next N days (default 7). Returns days remaining per offer.',
  requiredPermission: 'offer.view',
  inputSchema: OffersExpiringSoonInput,
  outputSchema: OffersExpiringSoonOutput,
  async execute(ctx, input) {
    const now = new Date()
    const horizon = new Date(Date.now() + input.withinDays * 24 * 60 * 60 * 1000)
    const rows = await db.offer.findMany({
      where: {
        organizationId: ctx.organizationId,
        status: 'ISSUED' as never,
        expiresAt: { gte: now, lte: horizon },
      },
      orderBy: { expiresAt: 'asc' },
      take: 50,
      include: {
        candidate: { select: { firstName: true, lastName: true } },
        hiringRequest: { select: { title: true } },
      },
    })
    return {
      total: rows.length,
      records: rows.map(r => ({
        id: r.id,
        status: r.status,
        title: r.title,
        candidateId: r.candidateId,
        candidateName: `${r.candidate.firstName} ${r.candidate.lastName}`.trim(),
        hiringRequestId: r.hiringRequestId,
        hiringRequestTitle: r.hiringRequest.title,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        daysRemaining: r.expiresAt
          ? Math.ceil((r.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
          : null,
      })),
    }
  },
}
