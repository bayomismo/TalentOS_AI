'use server'

/**
 * Sprint 17 — Integrations server actions.
 *
 * Google Calendar: connect / disconnect / status. Connecting is via
 * the /api/google/connect route (full-page redirect to Google).
 *
 * The "Connect" button in the UI just navigates the browser to
 * /api/google/connect. The callback lands on /settings and shows
 * the success/error state.
 */

import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import { recordAuditLog } from '@/lib/auth/audit'
import { getGoogleStatus, disconnectGoogle, type GoogleStatus } from '@/lib/integrations/google/service'

export type IntegrationsStatus = {
  google: GoogleStatus
}

export async function getIntegrationsStatusAction(): Promise<{
  ok: true
  data: IntegrationsStatus
} | { ok: false; error: string }> {
  const auth = await requirePermission('org.manage_integrations')
  if (!auth.ok) return toActionFailure(auth)
  const status = await getGoogleStatus(auth.data.organizationId)
  return { ok: true, data: { google: status } }
}

export async function disconnectGoogleAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requirePermission('org.manage_integrations')
  if (!auth.ok) return toActionFailure(auth)
  await disconnectGoogle(auth.data.organizationId)
  await recordAuditLog({
    organizationId: auth.data.organizationId,
    actorId: auth.data.userId,
    action: 'GOOGLE_INTEGRATION_DISCONNECTED' as never,
    targetType: 'integration',
    targetId: 'google-calendar',
    outcome: 'success',
  }).catch(() => null)
  return { ok: true }
}
