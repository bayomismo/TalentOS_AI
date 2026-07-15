'use server'

/**
 * Candidates server actions.
 *
 * Reads the live Prisma data so the AI Recruiter-created candidates (or
 * any candidate uploaded through the future ATS) appear in production.
 */

import { db } from '@/lib/db'
import type { Candidate } from '@/types'

export interface CandidatesPayload {
  candidates: Array<{
    id: string
    name: string
    email: string
    position: string
    stage: 'applied' | 'screening' | 'interview' | 'offer' | 'hired'
    rating: number
    source: string | null
    appliedAt: string
    avatar: string
  }>
}

export async function getCandidatesAction(): Promise<CandidatesPayload> {
  const orgId = await getDefaultOrgId()
  const rows = await db.candidate.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      stage: true,
      rating: true,
      source: true,
      appliedAt: true,
      hiringRequest: { select: { title: true } },
    },
    orderBy: { appliedAt: 'desc' },
    take: 100,
  })

  return {
    candidates: rows.map(c => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`,
      email: c.email,
      position: c.hiringRequest.title,
      stage: stageToUI(c.stage),
      rating: c.rating,
      source: c.source,
      appliedAt: c.appliedAt.toISOString(),
      avatar: avatarFor(c.firstName),
    })),
  }
}

function stageToUI(stage: string): 'applied' | 'screening' | 'interview' | 'offer' | 'hired' {
  switch (stage) {
    case 'APPLIED': return 'applied'
    case 'SCREENING': return 'screening'
    case 'INTERVIEW': return 'interview'
    case 'OFFER': return 'offer'
    case 'HIRED': return 'hired'
    case 'REJECTED':
    case 'WITHDRAWN':
    default:
      return 'applied'
  }
}

function avatarFor(name: string): string {
  // Simple deterministic emoji based on first letter
  const letter = name.charAt(0).toLowerCase()
  if ('aeiou'.includes(letter)) return '👩‍💼'
  return '👨‍💼'
}

async function getDefaultOrgId(): Promise<string> {
  const org = await db.organization.findFirst({ select: { id: true } })
  if (!org) throw new Error('No organization found. Run `pnpm db:seed` first.')
  return org.id
}
