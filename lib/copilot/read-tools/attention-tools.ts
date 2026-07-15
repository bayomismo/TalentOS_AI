/**
 * Sprint 11 — "What needs my attention?" tool.
 *
 * PART 14: a high-value tool that deterministically identifies
 * workflow items requiring the current user's attention. The
 * server decides what qualifies; Gemini only summarizes.
 */

import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { CopilotTool } from '../types'

const Input = z.object({})

const Output = z.object({
  userId: z.string(),
  summary: z.object({
    pendingEvaluations: z.number(),
    offersPendingApproval: z.number(),
    selectedCandidatesWithoutOffer: z.number(),
    offersExpiringSoon: z.number(),
    upcomingInterviews: z.number(),
    hiringRequestsWithNoCandidates: z.number(),
  }),
  items: z.array(z.object({
    kind: z.enum(['EVALUATION', 'OFFER_PENDING', 'SELECTED_NO_OFFER', 'OFFER_EXPIRING', 'INTERVIEW_SOON', 'HR_NO_CANDIDATES']),
    label: z.string(),
    href: z.string(),
    severity: z.enum(['high', 'medium', 'low']),
  })),
})

export const getMyAttentionItemsTool: CopilotTool<z.infer<typeof Input>, z.infer<typeof Output>> = {
  id: 'get_my_attention_items',
  description: 'Deterministically identify workflow items requiring the current user\'s attention: pending evaluations, offers pending approval, selected candidates without offers, offers expiring soon, upcoming interviews, and hiring requests with no candidates.',
  requiredPermission: 'candidate.view',
  inputSchema: Input,
  outputSchema: Output,
  async execute(ctx) {
    const orgId = ctx.organizationId
    const canApprove = ctx.hasPermission('offer.approve')

    // Pending evaluations (interview participant scope for INTERVIEWER)
    const pendingEvalWhere: any = {
      organizationId: orgId,
      status: 'COMPLETED' as never,
      evaluations: { none: {} },
    }
    if (ctx.role === 'INTERVIEWER') {
      pendingEvalWhere.participants = { some: { userId: ctx.userId } }
    }

    // Upcoming interviews
    const upcomingWhere: any = {
      organizationId: orgId,
      status: { in: ['SCHEDULED', 'CONFIRMED'] as never[] },
      scheduledAt: { gte: new Date() },
    }
    if (ctx.role === 'INTERVIEWER') {
      upcomingWhere.participants = { some: { userId: ctx.userId } }
    }

    const [pendingEvals, offersPending, selectedNoOffer, expiring, upcoming, hrsNoCands] = await Promise.all([
      db.interview.findMany({ where: pendingEvalWhere, take: 20, orderBy: { scheduledAt: 'desc' }, include: { candidate: { select: { id: true, firstName: true, lastName: true } }, hiringRequest: { select: { id: true, title: true } } } }),
      canApprove
        ? db.offer.findMany({ where: { organizationId: orgId, status: 'PENDING_APPROVAL' as never }, take: 20, include: { candidate: { select: { id: true, firstName: true, lastName: true } }, hiringRequest: { select: { id: true, title: true } } } })
        : Promise.resolve([]),
      db.candidateDecision.findMany({ where: { organizationId: orgId, decision: 'SELECTED' as never, candidate: { offers: { none: { status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'ACCEPTED'] as never[] } } } } }, take: 20, include: { candidate: { select: { id: true, firstName: true, lastName: true } }, hiringRequest: { select: { id: true, title: true } } } }),
      db.offer.findMany({ where: { organizationId: orgId, status: 'ISSUED' as never, expiresAt: { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } }, take: 20, include: { candidate: { select: { id: true, firstName: true, lastName: true } } } }),
      db.interview.findMany({ where: upcomingWhere, take: 20, orderBy: { scheduledAt: 'asc' }, include: { candidate: { select: { id: true, firstName: true, lastName: true } }, hiringRequest: { select: { id: true, title: true } } } }),
      db.hiringRequest.findMany({ where: { organizationId: orgId, status: { in: ['OPEN', 'DRAFT'] as never[] }, candidates: { none: {} }, createdAt: { lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }, take: 20 }),
    ])

    const items: z.infer<typeof Output>['items'] = []

    for (const e of pendingEvals) {
      items.push({
        kind: 'EVALUATION',
        label: `Submit evaluation: ${e.candidate.firstName} ${e.candidate.lastName} (${e.hiringRequest.title})`,
        href: `/candidates/${e.candidate.id}`,
        severity: 'high',
      })
    }
    for (const o of offersPending) {
      items.push({
        kind: 'OFFER_PENDING',
        label: `Approve offer: ${o.candidate.firstName} ${o.candidate.lastName} (${o.hiringRequest.title})`,
        href: `/offers/${o.id}`,
        severity: 'high',
      })
    }
    for (const s of selectedNoOffer) {
      items.push({
        kind: 'SELECTED_NO_OFFER',
        label: `Create offer for ${s.candidate.firstName} ${s.candidate.lastName} (selected ${s.decidedAt.toLocaleDateString()})`,
        href: `/candidates/${s.candidate.id}/offer`,
        severity: 'medium',
      })
    }
    for (const x of expiring) {
      items.push({
        kind: 'OFFER_EXPIRING',
        label: `Offer expiring soon: ${x.candidate.firstName} ${x.candidate.lastName}`,
        href: `/offers/${x.id}`,
        severity: 'medium',
      })
    }
    for (const i of upcoming) {
      items.push({
        kind: 'INTERVIEW_SOON',
        label: `Interview: ${i.candidate.firstName} ${i.candidate.lastName} on ${i.scheduledAt?.toLocaleString() ?? 'TBD'}`,
        href: `/candidates/${i.candidate.id}`,
        severity: 'low',
      })
    }
    for (const h of hrsNoCands) {
      items.push({
        kind: 'HR_NO_CANDIDATES',
        label: `Hiring request open >7d with no candidates: ${h.title}`,
        href: `/hiring-requests/${h.id}/candidates`,
        severity: 'low',
      })
    }

    return {
      userId: ctx.userId,
      summary: {
        pendingEvaluations: pendingEvals.length,
        offersPendingApproval: offersPending.length,
        selectedCandidatesWithoutOffer: selectedNoOffer.length,
        offersExpiringSoon: expiring.length,
        upcomingInterviews: upcoming.length,
        hiringRequestsWithNoCandidates: hrsNoCands.length,
      },
      items: items.slice(0, 30),
    }
  },
}
