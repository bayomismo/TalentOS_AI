'use server'

/**
 * Sprint 12 — User Management server actions.
 *
 * Thin wrapper over the user-management service. Every action:
 *   - calls requireAuth() to get the session
 *   - delegates to the service which enforces tenant isolation,
 *     RBAC, last-ADMIN protection, and audit logging
 */

import 'server-only'
import { requireAuth } from '@/lib/auth/authorize'
import { toActionFailure } from '@/lib/auth/adapter'
import {
  listUsers,
  changeUserRole,
  setUserStatus,
  createUserInvitation,
  listInvitations,
  revokeUserInvitation,
  type ListUsersInput,
  type ChangeRoleInput,
  type SetUserStatusInput,
  type CreateUserInvitationInput,
} from './service'
import type { ActionResult } from '@/lib/auth/action-helpers'

export async function listUsersAction(input: ListUsersInput): Promise<ActionResult<any>> {
  const auth = await requireAuth()
  if (!auth.ok) return toActionFailure(auth)
  const result = await listUsers({ organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role }, input)
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

export async function changeUserRoleAction(input: ChangeRoleInput): Promise<ActionResult<any>> {
  const auth = await requireAuth()
  if (!auth.ok) return toActionFailure(auth)
  const result = await changeUserRole({ organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role }, input)
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

export async function setUserStatusAction(input: SetUserStatusInput): Promise<ActionResult<any>> {
  const auth = await requireAuth()
  if (!auth.ok) return toActionFailure(auth)
  const result = await setUserStatus({ organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role }, input)
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

export async function createUserInvitationAction(input: CreateUserInvitationInput): Promise<ActionResult<any>> {
  const auth = await requireAuth()
  if (!auth.ok) return toActionFailure(auth)
  const result = await createUserInvitation({ organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role }, input)
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

export async function listInvitationsAction(): Promise<ActionResult<any>> {
  const auth = await requireAuth()
  if (!auth.ok) return toActionFailure(auth)
  const result = await listInvitations({ organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role })
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}

export async function revokeUserInvitationAction(invitationId: string): Promise<ActionResult<any>> {
  const auth = await requireAuth()
  if (!auth.ok) return toActionFailure(auth)
  const result = await revokeUserInvitation({ organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role }, invitationId)
  if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'ERROR', message: result.error?.message ?? 'Failed' } }
  return { ok: true, data: result.data }
}
