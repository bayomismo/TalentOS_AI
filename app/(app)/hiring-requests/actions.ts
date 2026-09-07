'use server'

/**
 * Hiring Requests server actions.
 *
 * `getHiringRequestsAction` reads the live Prisma data so new hiring
 * requests created from the AI Recruiter wizard show up immediately.
 *
 * The candidate count is computed in a single `groupBy` query across all
 * hiring requests in the org, so we don't pay the N+1 cost of running
 * one count per HR row.
 */

import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/authorize'
import type { ApplicationStage, Prisma } from '@prisma/client'

export interface HiringRequestsPayload {
  positions: Array<{
    id: string
    title: string
    department: string
    openings: number
    filled: number
    /** Total candidates on this HR (any stage, any analysis state). */
    candidates: number
    /** Candidates that have an AI match score. */
    analyzed: number
    /** Candidates currently in SCREENING / INTERVIEW / OFFER / HIRED. */
    shortlisted: number
    status: 'active' | 'closed'
    createdAt: string
  }>
  stats: {
    total: number
    active: number
    openings: number
    candidates: number
  }
}

const SHORTLISTED_STAGES: ApplicationStage[] = ['SCREENING', 'INTERVIEW', 'OFFER', 'HIRED']

export async function getHiringRequestsAction(): Promise<HiringRequestsPayload> {
  // Sprint 12: use the authenticated user's organization, not findFirst()
  // (findFirst() returned the wrong org in multi-tenant tests).
  const auth = await requireAuth()
  if (!auth.ok) {
    return { positions: [], stats: { total: 0, active: 0, openings: 0, candidates: 0 } }
  }
  const orgId = auth.data.organizationId

  const [rows, byHr] = await Promise.all([
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
    }),
    // One query, per-HR rollup. Avoids N+1.
    db.candidate.groupBy({
      by: ['hiringRequestId', 'stage'],
      where: { organizationId: orgId },
      _count: { _all: true },
      _min: { matchScore: true },
    }),
  ])

  // Roll up per HR: total, analyzed (any match score > 0), shortlisted.
  const rollup = new Map<string, { total: number; analyzed: number; shortlisted: number }>()
  for (const r of byHr as Array<{
    hiringRequestId: string
    stage: ApplicationStage
    _count: { _all: number }
    _min: { matchScore: number | null }
  }>) {
    const cur = rollup.get(r.hiringRequestId) ?? { total: 0, analyzed: 0, shortlisted: 0 }
    cur.total += r._count._all
    if (r._min.matchScore !== null && r._min.matchScore > 0) cur.analyzed += r._count._all
    if (SHORTLISTED_STAGES.includes(r.stage)) cur.shortlisted += r._count._all
    rollup.set(r.hiringRequestId, cur)
  }

  const positions = rows.map(r => {
    const counts = rollup.get(r.id) ?? { total: 0, analyzed: 0, shortlisted: 0 }
    return {
      id: r.id,
      title: r.title,
      department: r.department.name,
      openings: r.openings,
      filled: r.filled,
      candidates: counts.total,
      analyzed: counts.analyzed,
      shortlisted: counts.shortlisted,
      status: (
        r.status === 'CLOSED' || r.status === 'CANCELLED' || r.status === 'FILLED' ? 'closed' : 'active'
      ) as 'active' | 'closed',
      createdAt: r.createdAt.toISOString(),
    }
  })

  const active = positions.filter(p => p.status === 'active').length
  const openings = positions.reduce((sum, p) => sum + p.openings, 0)
  const totalCandidates = positions.reduce((sum, p) => sum + p.candidates, 0)

  return {
    positions,
    stats: {
      total: positions.length,
      active,
      openings,
      candidates: totalCandidates,
    },
  }
}

async function getDefaultOrgId(): Promise<string> {
  const org = await db.organization.findFirst({ select: { id: true } })
  if (!org) throw new Error('No organization found. Run `pnpm db:seed` first.')
  return org.id
}

// Suppress unused-type warning for the re-export below.
export type _PrismaAlias = Prisma.JsonValue
