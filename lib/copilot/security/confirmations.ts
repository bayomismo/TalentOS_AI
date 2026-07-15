/**
 * Sprint 11.1 — Confirmation security core.
 *
 * PART 5 + PART 11 + PART 12: server-controlled confirmation records
 * that gate every AI-proposed mutation. The browser never sends the
 * final authoritative mutation payload.
 *
 * Invariants enforced here:
 *   - Single-use: PENDING -> EXECUTED | EXPIRED | CANCELLED | FAILED
 *   - User-bound: userId must match at confirm
 *   - Org-bound: organizationId must match at confirm
 *   - Action-bound: actionId must match at confirm
 *   - Time-limited: expiresAt (default 10 minutes)
 *   - Concurrency-safe: status is checked + updated atomically
 */

import 'server-only'
import { db } from '@/lib/db'
import type { CopilotAuthContext } from '../types'
import type { ActionFailure, ConfirmationStatus } from '../actions/types'

export const CONFIRMATION_TTL_MS = 10 * 60 * 1000 // 10 minutes

export interface CreateConfirmationInput {
  userId: string
  organizationId: string
  actionId: string
  actionType: 'CREATE_HIRING_REQUEST_DRAFT' | 'SCHEDULE_INTERVIEW' | 'CREATE_OFFER_DRAFT'
  payload: unknown
  preview: unknown
  expiresInMs?: number
  conversationId?: string
}

export interface ConfirmationRecord {
  id: string
  organizationId: string
  userId: string
  actionId: string
  actionType: string
  payload: unknown
  preview: unknown
  status: ConfirmationStatus
  expiresAt: Date
  executedAt: Date | null
  cancelledAt: Date | null
  resultResourceId: string | null
  resultResourceType: string | null
  failureReason: string | null
}

/**
 * Create a PENDING confirmation row. This is called by `prepare()`.
 * NO business mutation occurs here.
 */
export async function createConfirmation(input: CreateConfirmationInput): Promise<ConfirmationRecord> {
  const expiresAt = new Date(Date.now() + (input.expiresInMs ?? CONFIRMATION_TTL_MS))
  const row = await db.copilotActionConfirmation.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      actionId: input.actionId,
      actionType: input.actionType as any,
      payload: input.payload as any,
      preview: input.preview as any,
      status: 'PENDING' as never,
      expiresAt,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    },
  })
  return rowToRecord(row)
}

/**
 * PART 11: load a confirmation and re-check ALL the invariants. This
 * is the function called at the start of every `execute()`. It must
 * be called BEFORE any domain service is invoked.
 *
 * Returns a discriminated result. On failure, the action MUST NOT
 * proceed.
 */
export async function loadAndValidateConfirmation(
  ctx: CopilotAuthContext,
  confirmationId: string,
  expectedActionId: string,
): Promise<
  | { ok: true; confirmation: ConfirmationRecord }
  | { ok: false; failure: ActionFailure }
> {
  // 1. Load the row by id (no org filter yet — we want a consistent
  //    "not found" vs "forbidden" error).
  const row = await db.copilotActionConfirmation.findUnique({
    where: { id: confirmationId },
  })

  if (!row) {
    return { ok: false, failure: { code: 'RESOURCE_NOT_FOUND', message: 'Confirmation not found.' } }
  }

  // 2. Org-bound: PART 5 — caller must be in the same org
  if (row.organizationId !== ctx.organizationId) {
    // PART 19: never leak existence — return NOT_FOUND on cross-tenant.
    return { ok: false, failure: { code: 'RESOURCE_NOT_FOUND', message: 'Confirmation not found.' } }
  }

  // 3. User-bound: PART 5 — caller must be the original user.
  if (row.userId !== ctx.userId) {
    return { ok: false, failure: { code: 'PERMISSION_DENIED', message: 'Confirmation belongs to another user.' } }
  }

  // 4. Action-bound: PART 5 — caller must pass the expected actionId
  if (row.actionId !== expectedActionId) {
    return { ok: false, failure: { code: 'RESOURCE_NOT_FOUND', message: 'Confirmation action mismatch.' } }
  }

  // 5. Status check: PART 12 — single-use
  if (row.status === 'EXECUTED') {
    return { ok: false, failure: { code: 'ALREADY_CONSUMED', message: 'Confirmation has already been used.' } }
  }
  if (row.status === 'CANCELLED') {
    return { ok: false, failure: { code: 'ALREADY_CONSUMED', message: 'Confirmation was cancelled.' } }
  }
  if (row.status === 'EXPIRED' || row.status === 'FAILED') {
    return { ok: false, failure: { code: 'EXPIRED', message: 'Confirmation is no longer valid.' } }
  }
  if (row.status !== 'PENDING') {
    return { ok: false, failure: { code: 'CONCURRENCY_CONFLICT', message: 'Confirmation is not in a usable state.' } }
  }

  // 6. Time-limited: PART 5
  if (row.expiresAt.getTime() <= Date.now()) {
    // Mark as EXPIRED so the next attempt is consistent.
    await db.copilotActionConfirmation.update({
      where: { id: row.id },
      data: { status: 'EXPIRED' as never },
    }).catch(() => null)
    return { ok: false, failure: { code: 'EXPIRED', message: 'Confirmation has expired. Please prepare the action again.' } }
  }

  return { ok: true, confirmation: rowToRecord(row) }
}

/**
 * PART 12: atomically mark a confirmation as EXECUTED. Uses a
 * conditional update so concurrent confirm attempts cannot both win.
 * Returns true if this caller won the race.
 */
export async function markExecuted(
  confirmationId: string,
  result: { resourceId: string; resourceType: string },
): Promise<boolean> {
  const updated = await db.copilotActionConfirmation.updateMany({
    where: { id: confirmationId, status: 'PENDING' as never },
    data: {
      status: 'EXECUTED' as never,
      executedAt: new Date(),
      resultResourceId: result.resourceId as any,
      resultResourceType: result.resourceType,
    },
  })
  return updated.count === 1
}

/**
 * Mark a confirmation as FAILED after a domain service error.
 */
export async function markFailed(confirmationId: string, reason: string): Promise<void> {
  await db.copilotActionConfirmation.update({
    where: { id: confirmationId },
    data: { status: 'FAILED' as never, failureReason: reason },
  }).catch(() => null)
}

/**
 * Mark a confirmation as CANCELLED. Idempotent.
 */
export async function markCancelled(confirmationId: string): Promise<void> {
  await db.copilotActionConfirmation.update({
    where: { id: confirmationId },
    data: { status: 'CANCELLED' as never, cancelledAt: new Date() },
  }).catch(() => null)
}

function rowToRecord(row: any): ConfirmationRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    actionId: row.actionId,
    actionType: row.actionType,
    payload: row.payload,
    preview: row.preview,
    status: row.status as ConfirmationStatus,
    expiresAt: row.expiresAt,
    executedAt: row.executedAt,
    cancelledAt: row.cancelledAt,
    resultResourceId: row.resultResourceId,
    resultResourceType: row.resultResourceType,
    failureReason: row.failureReason,
  }
}
