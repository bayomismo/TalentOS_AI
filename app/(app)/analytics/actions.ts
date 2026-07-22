'use server'

/**
 * Analytics data actions.
 *
 * `getAnalyticsDataAction` returns a tenant-scoped snapshot of the
 * organization's hiring funnel, hires-by-team breakdown, and candidate
 * source distribution. Computed live from Prisma; no static mocks.
 */

import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export interface FunnelStage {
  label: string
  value: number
  pct: number
}

export interface TeamHire {
  team: string
  value: number
  pct: number
}

export interface SourceShare {
  name: string
  share: number
  color: string
}

export interface MetricCard {
  label: string
  value: string
  trend: 'up' | 'down'
  helper: string
}

export interface AnalyticsData {
  candidateCount: number
  offerCount: number
  openRolesCount: number
  funnel: FunnelStage[]
  hiresByTeam: TeamHire[]
  sources: SourceShare[]
  metrics: MetricCard[]
}

const EMPTY: AnalyticsData = {
  candidateCount: 0,
  offerCount: 0,
  openRolesCount: 0,
  funnel: [],
  hiresByTeam: [],
  sources: [],
  metrics: [],
}

function pct(n: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((n / total) * 100)
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)))
}

export async function getAnalyticsDataAction(): Promise<AnalyticsData> {
  const auth = await requireAuth()
  if (!auth.ok) return EMPTY
  const orgId = auth.data.organizationId

  const [
    candidateCount,
    screenedCount,
    interviewedCount,
    offeredCount,
    hiredCount,
    sourceCounts,
    openRolesCount,
    offers,
  ] = await Promise.all([
    db.candidate.count({ where: { organizationId: orgId } }),
    db.candidate.count({
      where: {
        organizationId: orgId,
        stage: { in: ['SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'] },
      },
    }),
    db.candidate.count({
      where: {
        organizationId: orgId,
        stage: { in: ['INTERVIEW', 'OFFER', 'HIRED'] },
      },
    }),
    db.candidate.count({
      where: {
        organizationId: orgId,
        stage: { in: ['OFFER', 'HIRED'] },
      },
    }),
    db.candidate.count({ where: { organizationId: orgId, stage: 'HIRED' } }),
    db.candidate.groupBy({
      by: ['source'],
      where: { organizationId: orgId },
      _count: { _all: true },
    }),
    db.hiringRequest.count({
      where: { organizationId: orgId, status: { in: ['OPEN'] } },
    }),
    db.offer.findMany({
      where: { organizationId: orgId },
      select: { status: true, issuedAt: true, respondedAt: true },
    }),
  ])

  // Funnel
  const funnel: FunnelStage[] = [
    { label: 'Applied', value: candidateCount, pct: pct(candidateCount, candidateCount) },
    { label: 'Screened', value: screenedCount, pct: pct(screenedCount, candidateCount) },
    { label: 'Interviewed', value: interviewedCount, pct: pct(interviewedCount, candidateCount) },
    { label: 'Offered', value: offeredCount, pct: pct(offeredCount, candidateCount) },
    { label: 'Hired', value: hiredCount, pct: pct(hiredCount, candidateCount) },
  ]

  // Hires by team — group HIRED candidates by their hiring request's department.
  const hiredCandidates = await db.candidate.findMany({
    where: { organizationId: orgId, stage: 'HIRED' },
    select: {
      hiringRequest: { select: { departmentId: true } },
    },
  })

  const deptCounts = new Map<string, number>()
  for (const c of hiredCandidates) {
    const deptId = c.hiringRequest.departmentId
    deptCounts.set(deptId, (deptCounts.get(deptId) ?? 0) + 1)
  }
  const depts =
    deptCounts.size > 0
      ? await db.department.findMany({
          where: { id: { in: Array.from(deptCounts.keys()) } },
          select: { id: true, name: true },
        })
      : []
  const deptName = new Map(depts.map(d => [d.id, d.name]))
  const totalHires = Array.from(deptCounts.values()).reduce((a, b) => a + b, 0)
  const hiresByTeam: TeamHire[] = Array.from(deptCounts.entries())
    .map(([deptId, value]) => ({
      team: deptName.get(deptId) ?? 'Unassigned',
      value,
      pct: pct(value, totalHires),
    }))
    .sort((a, b) => b.value - a.value)

  // Sources
  const totalSourced = sourceCounts.reduce(
    (sum, s) => sum + s._count._all,
    0,
  )
  const palette = [
    'bg-emerald-500',
    'bg-blue-500',
    'bg-violet-500',
    'bg-amber-500',
    'bg-slate-400',
    'bg-rose-500',
    'bg-cyan-500',
  ]
  const sources: SourceShare[] = sourceCounts
    .map((s, i) => ({
      name: s.source ?? 'Unknown',
      share: pct(s._count._all, totalSourced),
      color: palette[i % palette.length]!,
    }))
    .sort((a, b) => b.share - a.share)

  // Offer acceptance
  const responded = offers.filter(o => o.respondedAt)
  const accepted = responded.filter(o => o.status === 'ACCEPTED').length
  const offerAcceptancePct =
    responded.length > 0 ? Math.round((accepted / responded.length) * 100) : 0

  // Interview → offer
  const interviewToOfferPct =
    interviewedCount > 0 ? Math.round((offeredCount / interviewedCount) * 100) : 0

  // Pipeline velocity
  const velocity = openRolesCount > 0 ? (candidateCount / openRolesCount).toFixed(1) : '0.0'

  // Time to hire (issued → accepted)
  const hiredOffers = offers.filter(
    o => o.status === 'ACCEPTED' && o.issuedAt && o.respondedAt,
  )
  let timeToHireDays: number | null = null
  if (hiredOffers.length > 0) {
    const totalDays = hiredOffers.reduce(
      (sum, o) => sum + daysBetween(o.issuedAt as Date, o.respondedAt as Date),
      0,
    )
    timeToHireDays = Math.round(totalDays / hiredOffers.length)
  }

  const metrics: MetricCard[] = [
    {
      label: 'Time to hire',
      value: timeToHireDays === null ? '—' : `${timeToHireDays} days`,
      trend: 'up',
      helper:
        hiredOffers.length === 0
          ? 'No accepted offers yet'
          : `Across ${hiredOffers.length} accepted offer${hiredOffers.length === 1 ? '' : 's'}`,
    },
    {
      label: 'Offer acceptance',
      value: responded.length === 0 ? '—' : `${offerAcceptancePct}%`,
      trend: offerAcceptancePct >= 70 ? 'up' : 'down',
      helper:
        responded.length === 0
          ? 'No offer responses yet'
          : `${accepted} accepted of ${responded.length} responded`,
    },
    {
      label: 'Pipeline velocity',
      value: velocity,
      trend: 'up',
      helper: `${candidateCount} candidates across ${openRolesCount} open role${openRolesCount === 1 ? '' : 's'}`,
    },
    {
      label: 'Hires',
      value: String(hiredCount),
      trend: 'up',
      helper: 'All-time for this organization',
    },
    {
      label: 'Interview → offer',
      value: interviewedCount === 0 ? '—' : `${interviewToOfferPct}%`,
      trend: interviewToOfferPct >= 30 ? 'up' : 'down',
      helper:
        interviewedCount === 0
          ? 'No interviews yet'
          : `${offeredCount} offered of ${interviewedCount} interviewed`,
    },
    {
      label: 'Open roles',
      value: String(openRolesCount),
      trend: 'up',
      helper: 'Active hiring requests',
    },
  ]

  return {
    candidateCount,
    offerCount: offers.length,
    openRolesCount,
    funnel,
    hiresByTeam,
    sources,
    metrics,
  }
}
