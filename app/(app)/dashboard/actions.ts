'use server'

/**
 * Dashboard data actions.
 *
 * `getDashboardDataAction` returns the live Prisma snapshot for the
 * dashboard — positions, candidates, activities, metrics. The client
 * component subscribes to bus events for live updates without a
 * re-fetch.
 *
 * Audit P2-02 — the dashboard used to ship fabricated trends and a
 * hardcoded `Avg. Time to Hire: '23 days'`. Every metric below is now
 * computed from the tenant's own rows, and every "change" is a real
 * period-over-period comparison against the same metric 30 days earlier
 * (a count delta expressed as a percentage). When there is no baseline to
 * compare against, the change is 0 — never an invented number.
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

/** Length of the comparison window used for every period-over-period change. */
const WINDOW_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** Percentage change between two values. 0 when there is no baseline. */
function pctChange(now: number, then: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(then) || then <= 0) return 0
  return Math.round(((now - then) / then) * 100)
}

/** Difference between two percentages, in percentage points. */
function pointDelta(now: number, then: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(then)) return 0
  return Math.round(now - then)
}

/** Trend arrow for a metric: up when the value grew, down when it shrank. */
function trendFor(now: number, then: number): 'up' | 'down' {
  return now >= then ? 'up' : 'down'
}

/** Whole days between two dates (never negative). */
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY_MS))
}

/** Average of a list of numbers, or null when the list is empty. */
function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export async function getDashboardDataAction(): Promise<DashboardData> {
  const auth = await requireAuth()
  if (!auth.ok) {
    return EMPTY_DASHBOARD
  }
  const orgId = auth.data.organizationId

  const now = new Date()
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * DAY_MS)
  const previousWindowStart = new Date(now.getTime() - 2 * WINDOW_DAYS * DAY_MS)
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const lastYearStart = new Date(now.getFullYear() - 1, 0, 1)
  const lastYearSamePeriod = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())

  const [
    positions,
    candidateGroups,
    candidateCountByRequest,
    activities,
    offerCounts,
    expiringSoonCount,
    expiringCountLastWindow,
    hiringRequestsOpenNow,
    hiringRequestsOpenThen,
    activeCandidatesNow,
    activeCandidatesThen,
    hiredCandidates,
    offersPendingNow,
    offersPendingThen,
    offersIssuedNow,
    offersIssuedThen,
    offersResponded,
  ] = await Promise.all([
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
    // Real candidate counts per requisition (the list shows this column).
    db.candidate.groupBy({
      by: ['hiringRequestId'],
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
        status: 'ISSUED',
        expiresAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) },
      },
    }),
    // The same forward-looking window, one month ago: offers that were
    // about to expire in the 7 days before the previous window started.
    db.offer.count({
      where: {
        organizationId: orgId,
        respondedAt: null,
        withdrawnAt: null,
        expiresAt: {
          gte: new Date(previousWindowStart.getTime() - 7 * DAY_MS),
          lte: previousWindowStart,
        },
      },
    }),
    // A requisition counts as open from the moment it was published until
    // it was closed — so the "30 days ago" figure is a real snapshot and
    // not the current status read backwards.
    db.hiringRequest.count({
      where: {
        organizationId: orgId,
        publishedAt: { not: null, lte: now },
        OR: [{ closedAt: null }, { closedAt: { gt: now } }],
      },
    }),
    db.hiringRequest.count({
      where: {
        organizationId: orgId,
        publishedAt: { not: null, lte: windowStart },
        OR: [{ closedAt: null }, { closedAt: { gt: windowStart } }],
      },
    }),
    db.candidate.count({
      where: { organizationId: orgId, rejectedAt: null, withdrawnAt: null },
    }),
    db.candidate.count({
      where: {
        organizationId: orgId,
        appliedAt: { lte: windowStart },
        AND: [
          { OR: [{ rejectedAt: null }, { rejectedAt: { gt: windowStart } }] },
          { OR: [{ withdrawnAt: null }, { withdrawnAt: { gt: windowStart } }] },
        ],
      },
    }),
    // Every hire with a lifecycle timestamp — the input of the real
    // time-to-hire calculation (audit P2-02 / P2-05).
    db.candidate.findMany({
      where: { organizationId: orgId, hiredAt: { not: null } },
      select: { appliedAt: true, hiredAt: true },
    }),
    db.offer.count({
      where: { organizationId: orgId, status: 'PENDING_APPROVAL' },
    }),
    db.offer.count({
      where: {
        organizationId: orgId,
        createdAt: { lte: windowStart },
        approvedAt: null,
        OR: [{ withdrawnAt: null }, { withdrawnAt: { gt: windowStart } }],
      },
    }),
    db.offer.count({
      where: { organizationId: orgId, status: 'ISSUED' },
    }),
    db.offer.count({
      where: {
        organizationId: orgId,
        issuedAt: { not: null, lte: windowStart },
        OR: [{ respondedAt: null }, { respondedAt: { gt: windowStart } }],
      },
    }),
    db.offer.findMany({
      where: { organizationId: orgId, respondedAt: { not: null } },
      select: { status: true, respondedAt: true },
    }),
  ])

  const candidatesByStage = {
    applied: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    hired: 0,
  }
  for (const g of candidateGroups) {
    if (g.stage === 'APPLIED') candidatesByStage.applied = g._count._all
    else if (g.stage === 'SCREENING') candidatesByStage.screening = g._count._all
    else if (g.stage === 'INTERVIEW') candidatesByStage.interview = g._count._all
    else if (g.stage === 'OFFER') candidatesByStage.offer = g._count._all
    else if (g.stage === 'HIRED') candidatesByStage.hired = g._count._all
  }
  const candidatesPerRequest = new Map(
    candidateCountByRequest.map(g => [g.hiringRequestId, g._count._all]),
  )

  // Sprint 10 — offer metrics
  const offerByStatus: Record<string, number> = {}
  for (const g of offerCounts) offerByStatus[g.status] = g._count._all
  const acceptedOffers = offerByStatus['ACCEPTED'] ?? 0
  const issuedTotal = (offerByStatus['ISSUED'] ?? 0) + acceptedOffers
  const acceptanceRate = issuedTotal > 0 ? Math.round((acceptedOffers / issuedTotal) * 100) : 0

  // Real time-to-hire: the gap between the candidate's application and the
  // moment they were hired. No hiredAt, no figure.
  const hireDurations = hiredCandidates
    .filter(c => c.hiredAt !== null)
    .map(c => daysBetween(c.appliedAt, c.hiredAt as Date))
  const allTimeTimeToHire = average(hireDurations)
  const recentTimeToHire = average(
    hiredCandidates
      .filter(c => c.hiredAt !== null && c.hiredAt > windowStart)
      .map(c => daysBetween(c.appliedAt, c.hiredAt as Date)),
  )
  const earlierTimeToHire = average(
    hiredCandidates
      .filter(c => c.hiredAt !== null && c.hiredAt <= windowStart)
      .map(c => daysBetween(c.appliedAt, c.hiredAt as Date)),
  )
  const timeToHireLabel =
    allTimeTimeToHire === null ? '—' : `${Math.round(allTimeTimeToHire)} days`

  // Offer acceptance — over the offers that have a response.
  const responded = offersResponded
  const accepted = responded.filter(o => o.status === 'ACCEPTED').length
  const acceptancePct = responded.length > 0 ? Math.round((accepted / responded.length) * 100) : 0
  const respondedBefore = responded.filter(o => (o.respondedAt as Date) <= windowStart)
  const acceptedBefore = respondedBefore.filter(o => o.status === 'ACCEPTED').length
  const acceptancePctBefore =
    respondedBefore.length > 0 ? Math.round((acceptedBefore / respondedBefore.length) * 100) : 0

  // Hires year to date, compared with the same period last year.
  const hiresYtd = hiredCandidates.filter(c => (c.hiredAt as Date) >= yearStart).length
  const hiresLastYearSamePeriod = hiredCandidates.filter(
    c => (c.hiredAt as Date) >= lastYearStart && (c.hiredAt as Date) <= lastYearSamePeriod,
  ).length

  const openPositions = hiringRequestsOpenNow
  const activeCandidates = activeCandidatesNow

  const metrics: DashboardData['metrics'] = [
    {
      label: 'Open Positions',
      value: openPositions,
      change: pctChange(openPositions, hiringRequestsOpenThen),
      trend: trendFor(openPositions, hiringRequestsOpenThen),
    },
    {
      label: 'Active Candidates',
      value: activeCandidates,
      change: pctChange(activeCandidates, activeCandidatesThen),
      trend: trendFor(activeCandidates, activeCandidatesThen),
    },
    {
      label: 'Pending Offer Approvals',
      value: offersPendingNow,
      change: pctChange(offersPendingNow, offersPendingThen),
      trend: trendFor(offersPendingNow, offersPendingThen),
    },
    {
      label: 'Offers Issued',
      value: offersIssuedNow,
      change: pctChange(offersIssuedNow, offersIssuedThen),
      trend: trendFor(offersIssuedNow, offersIssuedThen),
    },
    {
      label: 'Offer Acceptance Rate',
      value: `${acceptancePct}%`,
      change: pointDelta(acceptancePct, acceptancePctBefore),
      trend: trendFor(acceptancePct, acceptancePctBefore),
    },
    {
      label: 'Offers Expiring (7d)',
      value: expiringSoonCount,
      change: pctChange(expiringSoonCount, expiringCountLastWindow),
      trend: trendFor(expiringSoonCount, expiringCountLastWindow),
    },
    {
      label: 'Avg. Time to Hire',
      value: timeToHireLabel,
      change:
        recentTimeToHire === null || earlierTimeToHire === null
          ? 0
          : pctChange(recentTimeToHire, earlierTimeToHire),
      trend:
        recentTimeToHire === null || earlierTimeToHire === null
          ? 'up'
          : trendFor(recentTimeToHire, earlierTimeToHire),
    },
    {
      label: 'Candidates Hired (YTD)',
      value: hiresYtd,
      change: pctChange(hiresYtd, hiresLastYearSamePeriod),
      trend: trendFor(hiresYtd, hiresLastYearSamePeriod),
    },
  ]

  return {
    positions: positions.map(p => ({
      id: p.id,
      title: p.title,
      department: p.department.name,
      openings: p.openings,
      filled: p.filled,
      candidates: candidatesPerRequest.get(p.id) ?? 0,
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
