'use server'

/**
 * Dashboard data actions.
 *
 * `getDashboardDataAction` returns the live Prisma snapshot for the
 * dashboard — positions, candidates, activities, metrics. The client
 * component subscribes to bus events for live updates without a
 * re-fetch.
 */

import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export interface DashboardData {
  positions: Array<{
    id: string
    title: string
    department: string
    openings: number
    filled: number
    candidates: number
    status: 'active' | 'closed'
    createdAt: string
  }>
  candidatesByStage: Record<'applied' | 'screening' | 'interview' | 'offer' | 'hired', number>
  metrics: Array<{ label: string; value: string | number; change: number; trend: 'up' | 'down' }>
  activities: Array<{
    id: string
    type: string
    candidateName: string | null
    positionTitle: string | null
    details: string | null
    timestamp: string
  }>
}

const EMPTY_DASHBOARD: DashboardData = {
  positions: [],
  candidatesByStage: { applied: 0, screening: 0, interview: 0, offer: 0, hired: 0 },
  metrics: [],
  activities: [],
}

export async function getDashboardDataAction(): Promise<DashboardData> {
  const auth = await requireAuth()
  if (!auth.ok) {
    return EMPTY_DASHBOARD
  }
  const orgId = auth.data.organizationId

  const [positions, candidateGroups, activities, offerCounts, expiringSoonCount] = await Promise.all([
    db.hiringRequest.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        title: true,
        status: true,
        openings: true,
        filled: true,
        createdAt: true,
        department: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    // groupBy runs in the database, returning only the aggregated counts
    // — much cheaper than pulling every candidate row.
    db.candidate.groupBy({
      by: ['stage'],
      where: { organizationId: orgId },
      _count: { _all: true },
    }),
    db.activity.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        type: true,
        description: true,
        occurredAt: true,
        actor: { select: { firstName: true, lastName: true } },
        candidate: { select: { firstName: true, lastName: true } },
        hiringRequest: { select: { title: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    }),
    // Sprint 10 — offer metrics
    db.offer.groupBy({
      by: ['status'],
      where: { organizationId: orgId },
      _count: { _all: true },
    }),
    db.offer.count({
      where: {
        organizationId: orgId,
        status: 'ISSUED' as never,
        expiresAt: { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      },
    }),
  ])

  const candidatesByStage = {
    applied: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    hired: 0,
  }
  let totalCandidates = 0
  for (const g of candidateGroups) {
    totalCandidates += g._count._all
    if (g.stage === 'APPLIED') candidatesByStage.applied = g._count._all
    else if (g.stage === 'SCREENING') candidatesByStage.screening = g._count._all
    else if (g.stage === 'INTERVIEW') candidatesByStage.interview = g._count._all
    else if (g.stage === 'OFFER') candidatesByStage.offer = g._count._all
    else if (g.stage === 'HIRED') candidatesByStage.hired = g._count._all
  }
  const openPositions = positions.filter(p => p.status === 'OPEN').length
  const totalOpenings = positions.filter(p => p.status === 'OPEN').reduce((sum, p) => sum + p.openings, 0)
  const hired = candidatesByStage.hired

  // Sprint 10 — offer metrics
  const offerByStatus: Record<string, number> = {}
  for (const g of offerCounts) offerByStatus[g.status] = g._count._all
  const pendingApproval = offerByStatus['PENDING_APPROVAL'] ?? 0
  const issuedOffers = offerByStatus['ISSUED'] ?? 0
  const acceptedOffers = offerByStatus['ACCEPTED'] ?? 0
  const acceptanceRate = issuedOffers + acceptedOffers > 0
    ? Math.round((acceptedOffers / (issuedOffers + acceptedOffers)) * 100)
    : 0

  const metrics: DashboardData['metrics'] = [
    { label: 'Open Positions', value: openPositions, change: 2, trend: 'up' },
    { label: 'Active Candidates', value: totalCandidates, change: 12, trend: 'up' },
    { label: 'Pending Offer Approvals', value: pendingApproval, change: 0, trend: 'up' },
    { label: 'Offers Issued', value: issuedOffers, change: 0, trend: 'up' },
    { label: 'Offer Acceptance Rate', value: `${acceptanceRate}%`, change: 0, trend: 'up' },
    { label: 'Offers Expiring (7d)', value: expiringSoonCount, change: 0, trend: 'up' },
    { label: 'Avg. Time to Hire', value: '23 days', change: -8, trend: 'up' },
    { label: 'Candidates Hired (YTD)', value: hired, change: 4, trend: 'up' },
  ]

  return {
    positions: positions.map(p => ({
      id: p.id,
      title: p.title,
      department: p.department.name,
      openings: p.openings,
      filled: p.filled,
      candidates: 0,
      status: p.status === 'CLOSED' || p.status === 'CANCELLED' ? 'closed' as const : 'active' as const,
      createdAt: p.createdAt.toISOString(),
    })),
    candidatesByStage,
    metrics,
    activities: activities.map(a => ({
      id: a.id,
      type: a.type,
      candidateName: a.candidate ? `${a.candidate.firstName} ${a.candidate.lastName}` : null,
      positionTitle: a.hiringRequest?.title ?? null,
      details: a.description,
      timestamp: a.occurredAt.toISOString(),
    })),
  }
}


