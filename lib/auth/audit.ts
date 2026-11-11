/**
 * Sprint 9 — Audit log helper.
 *
 * PART 20: dedicated AuditLog model. Never store passwords, raw session
 * tokens, plaintext invitation tokens, API keys, or CV content.
 */

import { db } from '@/lib/db'
import type { AuditAction } from './types'

export interface AuditLogInput {
  organizationId?: string | null
  actorId?: string | null
  action: AuditAction
  targetType?: string | null
  targetId?: string | null
  outcome?: 'success' | 'failure' | 'denied'
  reason?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Records an audit event. Never throws — audit failures should not break
 * the user-facing request, and a business mutation must never be rolled
 * back because the trail could not be written.
 *
 * A failure IS observable: it is reported on stderr with the action and
 * the target ids, so a dropped audit row shows up in the logs instead of
 * disappearing. Audit P1-14: the trail used to be written best-effort
 * with nothing but a swallowed error, so a transient DB failure dropped
 * the entry while the business change persisted.
 *
 * Never logged: the metadata payload, the reason text, tokens, secrets
 * or request bodies.
 */
export async function recordAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        outcome: input.outcome ?? 'success',
        reason: input.reason ?? null,
        metadata: (input.metadata ?? {}) as object,
      },
    })
  } catch (err) {
    // Best-effort. Do not throw — the business mutation stands.
    // Only the action and the ids are reported: never the metadata,
    // never a token, never a request body.
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write audit log', {
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      organizationId: input.organizationId ?? null,
      actorId: input.actorId ?? null,
      outcome: input.outcome ?? 'success',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
