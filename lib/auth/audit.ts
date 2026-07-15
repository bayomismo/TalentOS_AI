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
 * the user-facing request. We do log to console.error so we can monitor
 * audit-write failures in production.
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
    // Best-effort. Do not throw.
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write audit log:', err)
  }
}
