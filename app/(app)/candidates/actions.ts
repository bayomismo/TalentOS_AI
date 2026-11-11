'use server'

/**
 * Candidates server actions.
 *
 * Reads the live Prisma data so the AI Recruiter-created candidates (or
 * any candidate uploaded through the future ATS) appear in production.
 */

import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'
import { allowedNextStages, isTerminalApplicationStage } from '@/lib/candidates/state-machine'
import { deriveCandidateStatus } from '@/lib/candidates/status'
import { evaluateHiringRequestCapacity } from '@/lib/hiring-requests/capacity'
import type { ApplicationStage } from '@prisma/client'
import type { Candidate } from '@/types'

/**
 * The UI stages the candidate list can render.
 *
 * Audit P2-01 — the union used to stop at `hired`, so REJECTED and
 * WITHDRAWN had nowhere to go and both fell through to `applied`. A
 * rejected candidate showed a green "Applied" badge in the global
 * Candidates list. Every pipeline stage now has a distinct UI value.
 */
export type CandidateUIStage =
  | 'applied'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'rejected'
  | 'withdrawn'

export interface CandidatesPayload {
  candidates: Array<{
    id: string
    name: string
    email: string
    position: string
    stage: CandidateUIStage
    /**
     * True when the candidate is in a terminal stage (HIRED, REJECTED,
     * WITHDRAWN). Audit P0-10 — a terminal candidate is finished: it
     * cannot be selected for a bulk move and it has no legal next
     * stage.
     */
    terminal: boolean
    /**
     * The stages this candidate may legally move to next, computed on
     * the server from the candidate state machine (audit P0-09). The UI
     * offers exactly these — it never offers a transition the server
     * would refuse.
     */
    allowedNextStages: ApplicationStage[]
    rating: number
    source: string | null
    appliedAt: string
    avatar: string
  }>
}

export async function getCandidatesAction(): Promise<CandidatesPayload> {
  const auth = await requirePermission('candidate.view')
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
      terminal: isTerminalApplicationStage(c.stage),
      allowedNextStages: [...allowedNextStages(c.stage)],
      rating: c.rating,
      source: c.source,
      appliedAt: c.appliedAt.toISOString(),
      avatar: avatarFor(c.firstName),
    })),
  }
}

/**
 * Maps a pipeline stage to the UI stage the candidate list renders.
 *
 * Audit P2-01 — REJECTED and WITHDRAWN used to fall through to `applied`,
 * so a rejected candidate was displayed with a green "Applied" badge. They
 * are terminal stages with their own meaning, so they get their own UI
 * value. The `default` branch is a defensive fallback for a stage the
 * enum does not have yet — it must never be reached for REJECTED or
 * WITHDRAWN.
 */
function stageToUI(stage: string): CandidateUIStage {
  switch (stage) {
    case 'APPLIED': return 'applied'
    case 'SCREENING': return 'screening'
    case 'INTERVIEW': return 'interview'
    case 'OFFER': return 'offer'
    case 'HIRED': return 'hired'
    case 'REJECTED': return 'rejected'
    case 'WITHDRAWN': return 'withdrawn'
    default: return 'applied'
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
  // Sprint 19 — `requirePermission('hiring_request.view')`, not a bare
  // `requireAuth()`: the picker lists requisitions, so the permission
  // registry decides. There is no hand-rolled role allowlist.
  const auth = await requirePermission('hiring_request.view')
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
    select: { id: true, title: true, openings: true, filled: true },
  })
  if (!hr) {
    return { ok: false, error: 'That hiring request could not be found.' }
  }

  // Audit P2-06 — ONE duplicate rule, not two contradictory ones.
  //
  // The database's unique key is `(organizationId, email, hiringRequestId)`
  // and the public-apply path honours it: one candidate row per person
  // PER REQUISITION. This action used to block the same email across the
  // WHOLE organization, which contradicted the public path and made it
  // impossible to add the same strong candidate to a second role.
  //
  // The rule now is: a person may hold ONE candidate row per requisition.
  // The same person applying to a second role is a legitimate second
  // application — the `Application` entity tracks the applications.
  const existing = await db.candidate.findFirst({
    where: { organizationId: orgId, email, hiringRequestId },
    select: { id: true },
  })
  if (existing) {
    return {
      ok: false,
      error: 'That candidate is already on this hiring request.',
    }
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

  // Audit P1-25 — the capacity gate. A requisition for 1 role must not
  // silently accumulate 40 candidates: `openings` is the budget a
  // recruiter set, and adding a candidate beyond it is refused with a
  // message that says exactly why.
  const capacity = await evaluateHiringRequestCapacity(db, {
    id: hr.id,
    title: hr.title,
    openings: hr.openings,
    filled: hr.filled,
  })
  if (!capacity.ok) {
    return { ok: false, error: capacity.message ?? 'This hiring request has no capacity left.' }
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
      // A new candidate always enters the pipeline at APPLIED. Audit
      // P1-27 — `status` is a real mirror of `stage`, not dead state.
      stage: 'APPLIED',
      status: deriveCandidateStatus('APPLIED'),
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


