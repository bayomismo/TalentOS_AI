'use server'

/**
 * Candidates server actions.
 *
 * Reads the live Prisma data so the AI Recruiter-created candidates (or
 * any candidate uploaded through the future ATS) appear in production.
 */

import { db } from '@/lib/db'
import { requireAuth, requirePermission } from '@/lib/auth'
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
  const auth = await requireAuth()
  if (!auth.ok) {
    return { candidates: [] }
  }
  const orgId = auth.data.organizationId
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

// -----------------------------------------------------------------------------
// Hiring requests for the Add-Candidate select
// -----------------------------------------------------------------------------

export interface HiringRequestOption {
  id: string
  title: string
}

export async function getHiringRequestsForSelectAction(): Promise<{
  ok: boolean
  requests: HiringRequestOption[]
}> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, requests: [] }
  const orgId = auth.data.organizationId
  const rows = await db.hiringRequest.findMany({
    where: { organizationId: orgId, status: { in: ['OPEN', 'DRAFT'] } },
    select: { id: true, title: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return { ok: true, requests: rows }
}

// -----------------------------------------------------------------------------
// createCandidateAction
// -----------------------------------------------------------------------------

export interface CreateCandidateInput {
  firstName: string
  lastName: string
  email: string
  hiringRequestId: string
  source?: string | null
  location?: string | null
}

export interface CreateCandidateResult {
  ok: boolean
  error?: string
  candidateId?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function createCandidateAction(
  input: CreateCandidateInput,
): Promise<CreateCandidateResult> {
  // Sprint 18 audit — was requireAuth() + hand-rolled role allowlist
  // (which incorrectly included HIRING_MANAGER). The permission
  // registry is the single source of truth: candidate.create is
  // granted to ADMIN, TA_LEAD, RECRUITER only.
  const auth = await requirePermission('candidate.create')
  if (!auth.ok) {
    return { ok: false, error: 'You do not have permission to add candidates.' }
  }
  const orgId = auth.data.organizationId

  const firstName = input.firstName.trim()
  const lastName = input.lastName.trim()
  const email = input.email.trim().toLowerCase()
  const hiringRequestId = input.hiringRequestId.trim()

  if (!firstName || !lastName) {
    return { ok: false, error: 'First and last name are required.' }
  }
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'A valid email is required.' }
  }
  if (!hiringRequestId) {
    return { ok: false, error: 'Please choose a hiring request for this candidate.' }
  }

  // Verify the hiring request belongs to this org.
  const hr = await db.hiringRequest.findFirst({
    where: { id: hiringRequestId, organizationId: orgId },
    select: { id: true },
  })
  if (!hr) {
    return { ok: false, error: 'That hiring request could not be found.' }
  }

  // Prevent duplicate email within the same org.
  const existing = await db.candidate.findFirst({
    where: { organizationId: orgId, email },
    select: { id: true },
  })
  if (existing) {
    return { ok: false, error: 'A candidate with this email already exists.' }
  }

  // Prevent adding the caller's own user account as a candidate.
  // Same email = same person. This is a real footgun: an admin adding
  // themselves by mistake pollutes the pipeline and confuses the
  // "who's a candidate" view. Refuse explicitly with a clear message.
  const self = await db.user.findFirst({
    where: { organizationId: orgId, email },
    select: { id: true },
  })
  if (self) {
    return {
      ok: false,
      error:
        'That email belongs to a member of your organization. You can\u2019t add a team member as a candidate \u2014 invite them to your team instead.',
    }
  }

  const created = await db.candidate.create({
    data: {
      organizationId: orgId,
      hiringRequestId,
      firstName,
      lastName,
      email,
      source: input.source?.trim() || null,
      location: input.location?.trim() || null,
      stage: 'APPLIED',
      status: 'ACTIVE',
    },
    select: { id: true },
  })

  return { ok: true, candidateId: created.id }
}

function avatarFor(name: string): string {
  // Simple deterministic emoji based on first letter
  const letter = name.charAt(0).toLowerCase()
  if ('aeiou'.includes(letter)) return '👩‍💼'
  return '👨‍💼'
}


