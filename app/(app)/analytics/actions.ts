'use server'

/**
 * Analytics data actions.
 *
 * `getAnalyticsDataAction` returns a tenant-scoped snapshot of the
 * organization's hiring funnel, hires-by-team breakdown, and candidate
 * source distribution. Computed live from Prisma; no static mocks.
 *
 * Audit P2-03 / P2-04 (audit-6 A45) — the hire count reported `NaN`
 * because the first metric whose label contained "hire" was the
 * time-to-hire card (`"12 days"`), which is not a count. The hire COUNT
 * now has its own unambiguous label and a plain numeric value.
 *
 * Audit P2-14 (audit-6 A47) — the funnel summed CUMULATIVE stage counts,
 * so every candidate that had moved on was counted again in the next
 * bucket (38 funnel points for 18 candidates). The funnel is now
 * MUTUALLY EXCLUSIVE: each candidate is counted exactly once, in the
 * furthest stage they have reached, and the percentages are relative to
 * the distinct candidates in the funnel cohort.
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
  /** Distinct candidates in the funnel cohort (rejected/withdrawn excluded). */
  funnelTotal: number
  funnel: FunnelStage[]
  hiresByTeam: TeamHire[]
  sources: SourceShare[]
  metrics: MetricCard[]
}

const EMPTY: AnalyticsData = {
  candidateCount: 0,
  offerCount: 0,
  openRolesCount: 0,
  funnelTotal: 0,
  funnel: [],
  hiresByTeam: [],
  sources: [],
  metrics: [],
}

function pct(n: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((n / total) * 100)
}

/**
 * Splits 100 percentage points across the parts so they add up to EXACTLY
 * 100 (audit P2-14: "conversion rates do not sum to 100% and are not
 * defensible in a customer review"). Independent rounding of each part
 * can produce 99% or 101%; the largest-remainder method fixes the
 * rounding drift by handing the leftover points to the parts with the
 * biggest fractional share.
 */
function allocatePct(values: number[], total: number): number[] {
  if (total <= 0 || values.length === 0) return values.map(() => 0)
  const exact = values.map(v => (v / total) * 100)
  const points = exact.map(e => Math.floor(e))
  let remainder = 100 - points.reduce((a, b) => a + b, 0)
  const byFraction = exact
    .map((e, i) => ({ i, fraction: e - Math.floor(e) }))
    .sort((a, b) => b.fraction - a.fraction)
  for (const part of byFraction) {
    if (remainder <= 0) break
    points[part.i] = points[part.i]! + 1
    remainder--
  }
  return points
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
    sourceCounts,
    openRolesCount,
    offers,
    pipelineCandidates,
  ] = await Promise.all([
    db.candidate.count({ where: { organizationId: orgId } }),
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
    // The funnel cohort: everyone still in play. A candidate who was
    // rejected or withdrew has LEFT the pipeline, so counting them in a
    // stage bucket would overstate the funnel.
    db.candidate.findMany({
      where: {
        organizationId: orgId,
        stage: { notIn: ['REJECTED', 'WITHDRAWN'] },
      },
      select: { id: true, stage: true },
    }),
  ])

  const pipelineIds = pipelineCandidates.map(c => c.id)

  // "Furthest stage reached" is evidenced by the candidate's own stage or
  // by the interview / offer that exists for them. Each candidate lands in
  // exactly ONE bucket, so the funnel never double-counts.
  const [offerRows, interviewRows] = await Promise.all([
    pipelineIds.length > 0
      ? db.offer.findMany({
          where: { organizationId: orgId, candidateId: { in: pipelineIds } },
          select: { candidateId: true },
          distinct: ['candidateId'],
        })
      : Promise.resolve([]),
    pipelineIds.length > 0
      ? db.interview.findMany({
          where: { organizationId: orgId, candidateId: { in: pipelineIds } },
          select: { candidateId: true },
          distinct: ['candidateId'],
        })
      : Promise.resolve([]),
  ])
  const offeredIds = new Set(offerRows.map(o => o.candidateId))
  const interviewedIds = new Set(interviewRows.map(i => i.candidateId))

  const buckets = { applied: 0, screened: 0, interviewed: 0, offered: 0, hired: 0 }
  for (const c of pipelineCandidates) {
    if (c.stage === 'HIRED') buckets.hired++
    else if (c.stage === 'OFFER' || offeredIds.has(c.id)) buckets.offered++
    else if (c.stage === 'INTERVIEW' || interviewedIds.has(c.id)) buckets.interviewed++
    else if (c.stage === 'SCREENING') buckets.screened++
    else buckets.applied++
  }

  const funnelTotal = pipelineCandidates.length
  const funnelValues = [buckets.applied, buckets.screened, buckets.interviewed, buckets.offered, buckets.hired]
  const funnelPcts = allocatePct(funnelValues, funnelTotal)
  const funnel: FunnelStage[] = [
    { label: 'Applied', value: buckets.applied, pct: funnelPcts[0]! },
    { label: 'Screened', value: buckets.screened, pct: funnelPcts[1]! },
    { label: 'Interviewed', value: buckets.interviewed, pct: funnelPcts[2]! },
    { label: 'Offered', value: buckets.offered, pct: funnelPcts[3]! },
    { label: 'Hired', value: buckets.hired, pct: funnelPcts[4]! },
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
  const teamEntries = Array.from(deptCounts.entries()).sort((a, b) => b[1] - a[1])
  const teamPcts = allocatePct(
    teamEntries.map(([, value]) => value),
    totalHires,
  )
  const hiresByTeam: TeamHire[] = teamEntries.map(([deptId, value], index) => ({
    team: deptName.get(deptId) ?? 'Unassigned',
    value,
    pct: teamPcts[index]!,
  }))

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

  // Interview → offer — of the candidates who reached an interview, how
  // many were offered (the offer stage and the hired stage both count as
  // "offered").
  const reachedInterview = buckets.interviewed + buckets.offered + buckets.hired
  const reachedOffer = buckets.offered + buckets.hired
  const interviewToOfferPct =
    reachedInterview > 0 ? Math.round((reachedOffer / reachedInterview) * 100) : 0

  // Pipeline velocity
  const velocity = openRolesCount > 0 ? (candidateCount / openRolesCount).toFixed(1) : '0.0'

  // Time from offer issued to offer accepted.
  const hiredOffers = offers.filter(
    o => o.status === 'ACCEPTED' && o.issuedAt && o.respondedAt,
  )
  let timeToAcceptDays: number | null = null
  if (hiredOffers.length > 0) {
    const totalDays = hiredOffers.reduce(
      (sum, o) => sum + daysBetween(o.issuedAt as Date, o.respondedAt as Date),
      0,
    )
    timeToAcceptDays = Math.round(totalDays / hiredOffers.length)
  }

  const hiredCount = buckets.hired

  const metrics: MetricCard[] = [
    {
      // Audit A45 — the HIRE COUNT. The label contains "hire" and the
      // value is the plain number of HIRED candidates.
      label: 'Candidates hired',
      value: String(hiredCount),
      trend: 'up',
      helper: 'All-time for this organization',
    },
    {
      label: 'Time to accept offer',
      value: timeToAcceptDays === null ? '—' : `${timeToAcceptDays} days`,
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
      label: 'Interview → offer',
      value: reachedInterview === 0 ? '—' : `${interviewToOfferPct}%`,
      trend: interviewToOfferPct >= 30 ? 'up' : 'down',
      helper:
        reachedInterview === 0
          ? 'No interviews yet'
          : `${reachedOffer} offered of ${reachedInterview} interviewed`,
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
    funnelTotal,
    funnel,
    hiresByTeam,
    sources,
    metrics,
  }
}
