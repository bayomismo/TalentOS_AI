/**
 * Sprint 19 — Hiring-request lifecycle enforcement (audit P1-17, P1-26,
 * P1-25).
 *
 * WHY THIS EXISTS
 * ---------------
 * `HiringRequest.status` had no lifecycle at all. `DRAFT` and `OPEN` were
 * written; `ON_HOLD`, `CLOSED`, `FILLED` and `CANCELLED` were unreachable
 * in application code. The visible symptom was the Hiring Requests
 * "Closed" filter permanently returning zero rows — an empty state that
 * looks like a bug to every user who clicks it.
 *
 * The pure transition table lives in `./state-machine.ts`. This module is
 * the server-side half: it applies a transition to the database, inside
 * the caller's transaction, and refuses anything the table forbids.
 *
 * DESIGN RULES (same contract as `lib/candidates/transition.ts`)
 *   1. It takes a `Prisma.TransactionClient` and NEVER imports `@/lib/db`.
 *      The caller owns the transaction.
 *   2. An illegal transition is a RETURNED RESULT, never a thrown error:
 *      `{ ok: false, error: { code: 'INVALID_TRANSITION', ... } }`.
 *   3. A database error propagates so the caller's transaction rolls back.
 *   4. It writes NO Activity and NO AuditLog rows — the caller owns those.
 *
 * SIDE EFFECTS
 * ------------
 * The status is never the only thing that changes:
 *
 *   - `OPEN`      → stamps `publishedAt` when it was never published.
 *   - `CLOSED` / `CANCELLED` → stamps `closedAt`.
 *   - `FILLED`    → recomputes `filled` from the pipeline, so the number
 *                   on the row can never disagree with the number of
 *                   HIRED candidates (audit P0-02 / P1-18).
 *
 * PUBLIC API
 * ----------
 *   transitionHiringRequestStatus(tx, input): Promise<HiringRequestStatusResult>
 *   attachJobDescription(tx, input): Promise<AttachJobDescriptionResult>
 *   updateHiringRequestOpenings(tx, input): Promise<UpdateOpeningsResult>
 */

import type { HiringRequestStatus, Prisma } from '@prisma/client'
import { validateHiringRequestTransition } from './state-machine'
import { syncHiringRequestFilled } from './capacity'

export interface HiringRequestStatusInput {
  hiringRequestId: string
  toStatus: HiringRequestStatus
  /**
   * The tenant the requisition must belong to. It is part of the WHERE
   * clause, not a post-hoc check, so a cross-tenant id can never be
   * transitioned (hard rule: tenant scoping includes the foreign key).
   */
  organizationId: string
  actorId?: string | null
  reason?: string | null
}

export type HiringRequestStatusResult =
  | {
      ok: true
      data: {
        hiringRequestId: string
        fromStatus: HiringRequestStatus
        toStatus: HiringRequestStatus
      }
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

/**
 * Moves a hiring request to a new status, inside the caller's transaction.
 *
 * Returns a failure result — never throws — when the transition is
 * illegal or the requisition does not belong to the tenant.
 */
export async function transitionHiringRequestStatus(
  tx: Prisma.TransactionClient,
  input: HiringRequestStatusInput,
): Promise<HiringRequestStatusResult> {
  const row = await tx.hiringRequest.findFirst({
    where: { id: input.hiringRequestId, organizationId: input.organizationId },
    select: { id: true, status: true, publishedAt: true },
  })

  if (!row) {
    return {
      ok: false,
      error: {
        code: 'HIRING_REQUEST_NOT_FOUND',
        message: 'Hiring request not found.',
        retryable: false,
      },
    }
  }

  const validation = validateHiringRequestTransition(row.status, input.toStatus)
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TRANSITION',
        message: validation.reason,
        retryable: false,
      },
    }
  }

  const now = new Date()
  await tx.hiringRequest.update({
    where: { id: row.id },
    data: {
      status: input.toStatus,
      // A requisition that goes live is published at that moment. A
      // re-opened requisition keeps its original publication date.
      ...(input.toStatus === 'OPEN' && row.publishedAt === null
        ? { publishedAt: now }
        : {}),
      ...(input.toStatus === 'CLOSED' || input.toStatus === 'CANCELLED'
        ? { closedAt: now }
        : {}),
      // Re-opening a closed requisition clears the closure date.
      ...(input.toStatus === 'OPEN' ? { closedAt: null } : {}),
    },
  })

  // `filled` is DERIVED, never accumulated (audit P0-02 / P1-18). A
  // requisition marked FILLED must show the real number of hires.
  if (input.toStatus === 'FILLED') {
    await syncHiringRequestFilled(tx, row.id)
  }

  return {
    ok: true,
    data: {
      hiringRequestId: row.id,
      fromStatus: row.status,
      toStatus: input.toStatus,
    },
  }
}

// -----------------------------------------------------------------------------
// Job description (audit P1-26)
// -----------------------------------------------------------------------------

export interface AttachJobDescriptionInput {
  hiringRequestId: string
  jobDescriptionId: string | null
  organizationId: string
}

export type AttachJobDescriptionResult =
  | { ok: true; data: { hiringRequestId: string; jobDescriptionId: string | null } }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

/**
 * Attaches (or detaches) the job description of a requisition.
 *
 * Audit P1-26 — `HiringRequest.jobDescriptionId` is nullable with
 * `onDelete: SetNull`. A business-reset deletion of the job description
 * left the HR stranded: ranking, interview-kit and decision-brief
 * services correctly returned `NO_JD`, but there was no way to give the
 * requisition a new one. This is that way.
 *
 * Both the requisition and the job description are tenant-scoped, and the
 * job description must belong to the SAME organization as the requisition.
 */
export async function attachJobDescription(
  tx: Prisma.TransactionClient,
  input: AttachJobDescriptionInput,
): Promise<AttachJobDescriptionResult> {
  const hr = await tx.hiringRequest.findFirst({
    where: { id: input.hiringRequestId, organizationId: input.organizationId },
    select: { id: true, jobDescriptionId: true },
  })
  if (!hr) {
    return {
      ok: false,
      error: {
        code: 'HIRING_REQUEST_NOT_FOUND',
        message: 'Hiring request not found.',
        retryable: false,
      },
    }
  }

  if (input.jobDescriptionId !== null) {
    const jd = await tx.jobDescription.findFirst({
      where: { id: input.jobDescriptionId, organizationId: input.organizationId },
      select: { id: true },
    })
    if (!jd) {
      return {
        ok: false,
        error: {
          code: 'JOB_DESCRIPTION_NOT_FOUND',
          message: 'That job description could not be found.',
          retryable: false,
        },
      }
    }
  }

  await tx.hiringRequest.update({
    where: { id: hr.id },
    data: { jobDescriptionId: input.jobDescriptionId },
  })

  return {
    ok: true,
    data: { hiringRequestId: hr.id, jobDescriptionId: input.jobDescriptionId },
  }
}

// -----------------------------------------------------------------------------
// Openings (audit P1-25)
// -----------------------------------------------------------------------------

export interface UpdateOpeningsInput {
  hiringRequestId: string
  openings: number
  organizationId: string
}

export type UpdateOpeningsResult =
  | { ok: true; data: { hiringRequestId: string; openings: number } }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

/**
 * Changes the number of openings on a requisition.
 *
 * Audit P1-25 — "openings are effectively hardcoded to 1": they were set
 * at creation and never editable, so the capacity gate could not be
 * adjusted by a recruiter without an engineer.
 *
 * The new value must be at least the number of people already hired
 * (raising the openings is always fine; lowering it below the recorded
 * hires would make the row lie about itself).
 */
export async function updateHiringRequestOpenings(
  tx: Prisma.TransactionClient,
  input: UpdateOpeningsInput,
): Promise<UpdateOpeningsResult> {
  const hr = await tx.hiringRequest.findFirst({
    where: { id: input.hiringRequestId, organizationId: input.organizationId },
    select: { id: true, filled: true },
  })
  if (!hr) {
    return {
      ok: false,
      error: {
        code: 'HIRING_REQUEST_NOT_FOUND',
        message: 'Hiring request not found.',
        retryable: false,
      },
    }
  }

  const openings = Math.floor(input.openings)
  if (!Number.isFinite(openings) || openings < 0) {
    return {
      ok: false,
      error: {
        code: 'INVALID_OPENINGS',
        message: 'Openings must be zero or a positive whole number.',
        retryable: false,
      },
    }
  }

  if (openings < hr.filled) {
    return {
      ok: false,
      error: {
        code: 'OPENINGS_BELOW_FILLED',
        message: `This requisition already has ${hr.filled} hire${hr.filled === 1 ? '' : 's'}. Set the openings to at least ${hr.filled}.`,
        retryable: false,
      },
    }
  }

  await tx.hiringRequest.update({
    where: { id: hr.id },
    data: { openings },
  })

  return { ok: true, data: { hiringRequestId: hr.id, openings } }
}
