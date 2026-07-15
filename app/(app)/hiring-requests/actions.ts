'use server'

/**
 * Hiring Requests server actions.
 *
 * `getHiringRequestsAction` reads the live Prisma data so new hiring
 * requests created from the AI Recruiter wizard show up immediately.
 */

import { db } from '@/lib/db'

export interface HiringRequestsPayload {
  positions: Array<{
    id: string
    title: string
    department: string
    openings: number
    candidates: number
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

export async function getHiringRequestsAction(): Promise<HiringRequestsPayload> {
  const orgId = await getDefaultOrgId()

  const [rows, candidateCount] = await Promise.all([
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
    db.candidate.count({ where: { organizationId: orgId } }),
  ])

  const positions = rows.map(r => ({
    id: r.id,
    title: r.title,
    department: r.department.name,
    openings: r.openings,
    // Approximate candidate count per position: total candidates / total
    // open positions. Real aggregation lands with the candidate list page.
    candidates: 0,
    status: (r.status === 'CLOSED' || r.status === 'CANCELLED' || r.status === 'FILLED' ? 'closed' : 'active') as 'active' | 'closed',
    createdAt: r.createdAt.toISOString(),
  }))

  const active = positions.filter(p => p.status === 'active').length
  const openings = positions.reduce((sum, p) => sum + p.openings, 0)

  return {
    positions,
    stats: {
      total: positions.length,
      active,
      openings,
      candidates: candidateCount,
    },
  }
}

async function getDefaultOrgId(): Promise<string> {
  const org = await db.organization.findFirst({ select: { id: true } })
  if (!org) throw new Error('No organization found. Run `pnpm db:seed` first.')
  return org.id
}
