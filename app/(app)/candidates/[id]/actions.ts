'use server'

/**
 * Candidate detail server action.
 */

import { db } from '@/lib/db'

export interface CandidateDetail {
  id: string
  name: string
  email: string
  position: string
  stage: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn'
  rating: number
  source: string | null
  appliedAt: string
  location: string | null
  avatar: string
  jobDescriptionSummary: string | null
  department: string
}

export async function getCandidateDetailAction(id: string): Promise<CandidateDetail | null> {
  const c = await db.candidate.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      stage: true,
      rating: true,
      source: true,
      appliedAt: true,
      location: true,
      avatarUrl: true,
      hiringRequest: {
        select: {
          title: true,
          department: { select: { name: true } },
          jobDescription: { select: { summary: true } },
        },
      },
    },
  })

  if (!c) return null

  return {
    id: c.id,
    name: `${c.firstName} ${c.lastName}`,
    email: c.email,
    position: c.hiringRequest.title,
    stage: c.stage.toLowerCase() as CandidateDetail['stage'],
    rating: c.rating,
    source: c.source,
    appliedAt: c.appliedAt.toISOString(),
    location: c.location,
    avatar: c.avatarUrl ?? '👤',
    jobDescriptionSummary: c.hiringRequest.jobDescription?.summary ?? null,
    department: c.hiringRequest.department.name,
  }
}
