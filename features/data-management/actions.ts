'use server'

/**
 * Sprint 12 — Data Management server actions.
 *
 * ADMIN-only safe cleanup of demo/test/E2E records.
 */

import 'server-only'
import { requireAuth } from '@/lib/auth/authorize'
import { toActionFailure } from '@/lib/auth/adapter'
import { previewDataManagement, executeDataCleanup } from './service'
import type { ActionResult } from '@/lib/auth/action-helpers'

export async function previewDataManagementAction(): Promise<ActionResult<any>> {
  const auth = await requireAuth()
  if (!auth.ok) return toActionFailure(auth)
  const result = await previewDataManagement({ organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role })
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

export async function executeDataCleanupAction(confirmation: string): Promise<ActionResult<any>> {
  const auth = await requireAuth()
  if (!auth.ok) return toActionFailure(auth)
  const result = await executeDataCleanup({ organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role }, confirmation)
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}
