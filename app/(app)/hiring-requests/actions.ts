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
 *
 * Sprint 19 — the requisition LIFECYCLE (audit P1-17). Before this pass
 * `DRAFT` and `OPEN` were the only statuses ever written, so `CLOSED`,
 * `FILLED`, `ON_HOLD` and `CANCELLED` were unreachable and the "Closed"
 * filter was a permanent empty state. The transitions are enforced by
 * `lib/hiring-requests/state-machine.ts` and applied by
 * `lib/hiring-requests/lifecycle.ts`.
 *
 * RBAC: every mutation goes through `requirePermission()`. There is no
 * hand-rolled role allowlist anywhere in this file.
 */

import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth/authorize'
import { recordAuditLog } from '@/lib/auth/audit'
import { safeRevalidate } from '@/lib/utils/revalidate'
import { toActionFailure } from '@/lib/auth/adapter'
import {
  attachJobDescription,
  transitionHiringRequestStatus,
  updateHiringRequestOpenings,
} from '@/lib/hiring-requests/lifecycle'
import { allowedNextHiringRequestStatuses } from '@/lib/hiring-requests/state-machine'
import type { ApplicationStage, HiringRequestStatus } from '@prisma/client'

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
    /**
     * The coarse status the shared `Position` table renders.
     * CLOSED / CANCELLED / FILLED are "closed"; everything else is "active".
     */
    status: 'active' | 'closed'
    /**
     * The real requisition status (audit P1-17). `ON_HOLD`, `CLOSED`,
     * `FILLED` and `CANCELLED` are now reachable, so the list must show
     * which one it is.
     */
    hrStatus: HiringRequestStatus
    /**
     * The statuses this requisition may legally move to next, computed on
     * the server from the hiring-request state machine. The UI offers
     * exactly these.
     */
    allowedNextStatuses: HiringRequestStatus[]
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
  // Sprint 19: `requirePermission('hiring_request.view')`, not a bare
  // `requireAuth()` — the permission registry decides who may list
  // requisitions. There is no hand-rolled role allowlist.
  const auth = await requirePermission('hiring_request.view')
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

  // Roll up per HR: total, analyzed (any match score > 0), shortlisted,
  // hired. Audit P0-02 / P1-18 — `filled` is DERIVED from the pipeline
  // (the number of candidates on this requisition in stage HIRED), so the
  // list, the workspace and the Decision Hub all read the same fact.
  const rollup = new Map<
    string,
    { total: number; analyzed: number; shortlisted: number; hired: number }
  >()
  for (const r of byHr as Array<{
    hiringRequestId: string
    stage: ApplicationStage
    _count: { _all: number }
    _min: { matchScore: number | null }
  }>) {
    const cur = rollup.get(r.hiringRequestId) ?? {
      total: 0,
      analyzed: 0,
      shortlisted: 0,
      hired: 0,
    }
    cur.total += r._count._all
    if (r._min.matchScore !== null && r._min.matchScore > 0) cur.analyzed += r._count._all
    if (SHORTLISTED_STAGES.includes(r.stage)) cur.shortlisted += r._count._all
    if (r.stage === 'HIRED') cur.hired += r._count._all
    rollup.set(r.hiringRequestId, cur)
  }

  const positions = rows.map(r => {
    const counts = rollup.get(r.id) ?? { total: 0, analyzed: 0, shortlisted: 0, hired: 0 }
    return {
      id: r.id,
      title: r.title,
      department: r.department.name,
      openings: r.openings,
      // Derived, never read from the stored column: the stored column is
      // refreshed on every stage write, but the LIST must not show a
      // stale value if a write path ever missed it.
      filled: Math.max(0, counts.hired),
      candidates: counts.total,
      analyzed: counts.analyzed,
      shortlisted: counts.shortlisted,
      status: (
        r.status === 'CLOSED' || r.status === 'CANCELLED' || r.status === 'FILLED' ? 'closed' : 'active'
      ) as 'active' | 'closed',
      hrStatus: r.status,
      allowedNextStatuses: [...allowedNextHiringRequestStatuses(r.status)],
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

// -----------------------------------------------------------------------------
// Requisition lifecycle (audit P1-17)
// -----------------------------------------------------------------------------

export interface UpdateHiringRequestStatusInput {
  hiringRequestId: string
  toStatus: HiringRequestStatus
  reason?: string
}

export type HiringRequestActionResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

/**
 * The permission a status change requires.
 *
 * Closing, cancelling or filling a requisition is a `hiring_request.close`
 * operation — the "this role is done" capability. Opening, pausing and
 * resuming one is `hiring_request.edit`.
 */
function permissionForStatusChange(toStatus: HiringRequestStatus): 'hiring_request.close' | 'hiring_request.edit' {
  return toStatus === 'CLOSED' || toStatus === 'CANCELLED' || toStatus === 'FILLED'
    ? 'hiring_request.close'
    : 'hiring_request.edit'
}

/**
 * Moves a requisition through its lifecycle.
 *
 * Audit P1-17 — `CLOSED`, `FILLED`, `ON_HOLD` and `CANCELLED` were
 * unreachable, so the "Closed" filter on the hiring-requests list was a
 * permanent empty state. This action is what makes them reachable, and
 * the state machine in `lib/hiring-requests/state-machine.ts` is what
 * keeps the moves legal.
 */
export async function updateHiringRequestStatusAction(
  input: UpdateHiringRequestStatusInput,
): Promise<HiringRequestActionResult<{ fromStatus: HiringRequestStatus; toStatus: HiringRequestStatus }>> {
  try {
    const permission = permissionForStatusChange(input.toStatus)
    const auth = await requirePermission(permission)
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    const outcome = await db.$transaction(async tx =>
      transitionHiringRequestStatus(tx, {
        hiringRequestId: input.hiringRequestId,
        toStatus: input.toStatus,
        organizationId: orgId,
        actorId: auth.data.userId,
        reason: input.reason ?? null,
      }),
    )

    if (!outcome.ok) {
      return { ok: false, error: outcome.error }
    }

    await recordAuditLog({
      organizationId: orgId,
      actorId: auth.data.userId,
      action: 'HIRING_REQUEST_STATUS_CHANGED' as never,
      targetType: 'hiring_request',
      targetId: input.hiringRequestId,
      outcome: 'success',
      metadata: {
        from: outcome.data.fromStatus,
        to: outcome.data.toStatus,
        reason: input.reason ?? null,
      } as never,
    }).catch(() => null)

    safeRevalidate('/hiring-requests')
    safeRevalidate(`/hiring-requests/${input.hiringRequestId}/candidates`)
    return {
      ok: true,
      data: { fromStatus: outcome.data.fromStatus, toStatus: outcome.data.toStatus },
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : 'Unexpected error',
        retryable: true,
      },
    }
  }
}

// -----------------------------------------------------------------------------
// Job description (audit P1-26)
// -----------------------------------------------------------------------------

export interface AttachJobDescriptionInput {
  hiringRequestId: string
  /** `null` detaches the current job description. */
  jobDescriptionId: string | null
}

export interface JobDescriptionOption {
  id: string
  title: string
}

/**
 * The job descriptions a recruiter can attach to a requisition.
 *
 * Audit P1-26 — a requisition whose job description was deleted was
 * stranded with no way to give it a new one. It needs a list to choose
 * from.
 */
export async function listJobDescriptionsAction(): Promise<
  HiringRequestActionResult<{ jobDescriptions: JobDescriptionOption[] }>
> {
  try {
    const auth = await requirePermission('hiring_request.edit')
    if (!auth.ok) return toActionFailure(auth)
    const rows = await db.jobDescription.findMany({
      where: { organizationId: auth.data.organizationId },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
      take: 200,
    })
    return { ok: true, data: { jobDescriptions: rows } }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : 'Unexpected error',
        retryable: true,
      },
    }
  }
}

/**
 * Attaches (or detaches) a requisition's job description.
 *
 * Audit P1-26 — see `lib/hiring-requests/lifecycle.ts`.
 */
export async function attachJobDescriptionAction(
  input: AttachJobDescriptionInput,
): Promise<HiringRequestActionResult<{ jobDescriptionId: string | null }>> {
  try {
    const auth = await requirePermission('hiring_request.edit')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    const outcome = await db.$transaction(async tx =>
      attachJobDescription(tx, {
        hiringRequestId: input.hiringRequestId,
        jobDescriptionId: input.jobDescriptionId,
        organizationId: orgId,
      }),
    )

    if (!outcome.ok) {
      return { ok: false, error: outcome.error }
    }

    await recordAuditLog({
      organizationId: orgId,
      actorId: auth.data.userId,
      action: 'HIRING_REQUEST_JOB_DESCRIPTION_CHANGED' as never,
      targetType: 'hiring_request',
      targetId: input.hiringRequestId,
      outcome: 'success',
      metadata: { jobDescriptionId: input.jobDescriptionId } as never,
    }).catch(() => null)

    safeRevalidate(`/hiring-requests/${input.hiringRequestId}/candidates`)
    return { ok: true, data: { jobDescriptionId: outcome.data.jobDescriptionId } }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : 'Unexpected error',
        retryable: true,
      },
    }
  }
}

// -----------------------------------------------------------------------------
// Openings (audit P1-25)
// -----------------------------------------------------------------------------

export interface UpdateHiringRequestOpeningsInput {
  hiringRequestId: string
  openings: number
}

/**
 * Changes the number of openings on a requisition.
 *
 * Audit P1-25 — openings were set at creation and never editable, so the
 * capacity gate could not be adjusted without an engineer.
 */
export async function updateHiringRequestOpeningsAction(
  input: UpdateHiringRequestOpeningsInput,
): Promise<HiringRequestActionResult<{ openings: number }>> {
  try {
    const auth = await requirePermission('hiring_request.edit')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    const outcome = await db.$transaction(async tx =>
      updateHiringRequestOpenings(tx, {
        hiringRequestId: input.hiringRequestId,
        openings: input.openings,
        organizationId: orgId,
      }),
    )

    if (!outcome.ok) {
      return { ok: false, error: outcome.error }
    }

    safeRevalidate('/hiring-requests')
    safeRevalidate(`/hiring-requests/${input.hiringRequestId}/candidates`)
    return { ok: true, data: { openings: outcome.data.openings } }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : 'Unexpected error',
        retryable: true,
      },
    }
  }
}
