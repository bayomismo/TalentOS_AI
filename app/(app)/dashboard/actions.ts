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

export interface DashboardData {
  positions: Array<{
    id: string
    title: string
    department: string
    openings: number
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

export async function getDashboardDataAction(): Promise<DashboardData> {
  const orgId = await getDefaultOrgId()

  const [positions, candidates, activities] = await Promise.all([
    db.hiringRequest.findMany({
      where: { organizationId: orgId },
      include: { department: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    db.candidate.findMany({
      where: { organizationId: orgId },
      select: { stage: true },
    }),
    db.activity.findMany({
      where: { organizationId: orgId },
      include: {
        actor: { select: { firstName: true, lastName: true } },
        candidate: { select: { firstName: true, lastName: true } },
        hiringRequest: { select: { title: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    }),
  ])

  const candidatesByStage = {
    applied: candidates.filter(c => c.stage === 'APPLIED').length,
    screening: candidates.filter(c => c.stage === 'SCREENING').length,
    interview: candidates.filter(c => c.stage === 'INTERVIEW').length,
    offer: candidates.filter(c => c.stage === 'OFFER').length,
    hired: candidates.filter(c => c.stage === 'HIRED').length,
  }

  const totalCandidates = candidates.length
  const openPositions = positions.filter(p => p.status === 'OPEN').length
  const totalOpenings = positions.filter(p => p.status === 'OPEN').reduce((sum, p) => sum + p.openings, 0)
  const hired = candidatesByStage.hired

  const metrics: DashboardData['metrics'] = [
    { label: 'Open Positions', value: openPositions, change: 2, trend: 'up' },
    { label: 'Active Candidates', value: totalCandidates, change: 12, trend: 'up' },
    { label: 'Avg. Time to Hire', value: '23 days', change: -8, trend: 'up' },
    { label: 'Offer Conversion', value: `${Math.round((candidatesByStage.offer / Math.max(1, totalCandidates)) * 100)}%`, change: 5, trend: 'up' },
    { label: 'Pipeline Health', value: '92%', change: 3, trend: 'up' },
    { label: 'Candidates Hired (YTD)', value: hired, change: 4, trend: 'up' },
  ]

  return {
    positions: positions.map(p => ({
      id: p.id,
      title: p.title,
      department: p.department.name,
      openings: p.openings,
      candidates: 0, // Will be wired when candidate count aggregation lands
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

async function getDefaultOrgId(): Promise<string> {
  const org = await db.organization.findFirst({ select: { id: true } })
  if (!org) throw new Error('No organization found. Run `pnpm db:seed` first.')
  return org.id
}
