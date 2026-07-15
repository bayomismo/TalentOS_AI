/**
 * Sprint 11 — Copilot auth context helper.
 *
 * Resolves the session once and exposes `hasPermission` for tool
 * permission checks. Tools must use this context, not the raw
 * auth() result.
 */

import 'server-only'
import { hasPermission as rbacHasPermission } from '@/lib/auth/permissions'
import { requireAuth } from '@/lib/auth/authorize'
import type { CopilotAuthContext } from './types'

export async function resolveCopilotContext(): Promise<CopilotAuthContext> {
  const auth = await requireAuth()
  if (!auth.ok) {
    throw new Error('UNAUTHENTICATED')
  }
  return {
    userId: auth.data.userId,
    organizationId: auth.data.organizationId,
    role: auth.data.role,
    isAdmin: auth.data.isAdmin,
    hasPermission: (p) => rbacHasPermission(auth.data.role, p),
  }
}
