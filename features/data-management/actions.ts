'use server'

/**
 * Sprint 12 — Data Management server actions.
 *
 * ADMIN-only safe cleanup of demo/test/E2E records, plus the data-rights
 * flows (access + erasure) introduced by audit P2-13.
 *
 * Authorization: every action gates on `requirePermission()` — the single
 * RBAC entry point — and the service re-checks the same permission as
 * defence in depth. No hand-rolled role allowlist anywhere.
 */

import 'server-only'
import { requirePermission } from '@/lib/auth/authorize'
import { toActionFailure } from '@/lib/auth/adapter'
import { previewDataManagement, executeDataCleanup, previewBusinessReset, executeBusinessReset } from './service'
import {
  listRightsCandidates,
  previewCandidateRights,
  exportCandidateData,
  eraseCandidateData,
} from './rights-service'
import type { ActionResult } from '@/lib/auth/action-helpers'

export async function previewDataManagementAction(): Promise<ActionResult<any>> {
  const auth = await requirePermission('organization.manage')
  if (!auth.ok) return toActionFailure(auth)
  const result = await previewDataManagement({ organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role })
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

export async function executeDataCleanupAction(confirmation: string): Promise<ActionResult<any>> {
  const auth = await requirePermission('organization.manage')
  if (!auth.ok) return toActionFailure(auth)
  const result = await executeDataCleanup({ organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role }, confirmation)
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

export async function previewBusinessResetAction(): Promise<ActionResult<any>> {
  const auth = await requirePermission('organization.manage')
  if (!auth.ok) return toActionFailure(auth)
  const result = await previewBusinessReset({ organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role })
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

export async function executeBusinessResetAction(confirmation: string): Promise<ActionResult<any>> {
  const auth = await requirePermission('organization.manage')
  if (!auth.ok) return toActionFailure(auth)
  const result = await executeBusinessReset({ organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role }, confirmation)
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

// -----------------------------------------------------------------------------
// Data rights (audit P2-13) — access + erasure for one candidate
// -----------------------------------------------------------------------------

/** The candidates an admin can run a data-rights request against. */
export async function listRightsCandidatesAction(): Promise<ActionResult<any>> {
  const auth = await requirePermission('organization.manage')
  if (!auth.ok) return toActionFailure(auth)
  const result = await listRightsCandidates({
    organizationId: auth.data.organizationId,
    userId: auth.data.userId,
    role: auth.data.role,
  })
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

/** What we hold about a candidate, and what an erasure would remove. */
export async function previewCandidateRightsAction(candidateId: string): Promise<ActionResult<any>> {
  const auth = await requirePermission('organization.manage')
  if (!auth.ok) return toActionFailure(auth)
  const result = await previewCandidateRights(
    { organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role },
    candidateId,
  )
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

/** The full data-subject access bundle for one candidate. */
export async function exportCandidateDataAction(candidateId: string): Promise<ActionResult<any>> {
  const auth = await requirePermission('organization.manage')
  if (!auth.ok) return toActionFailure(auth)
  const result = await exportCandidateData(
    { organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role },
    candidateId,
  )
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

/** Erases one candidate (and their CV bytes) from the tenant. */
export async function eraseCandidateDataAction(candidateId: string, confirmation: string): Promise<ActionResult<any>> {
  const auth = await requirePermission('organization.manage')
  if (!auth.ok) return toActionFailure(auth)
  const result = await eraseCandidateData(
    { organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role },
    candidateId,
    confirmation,
  )
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}
