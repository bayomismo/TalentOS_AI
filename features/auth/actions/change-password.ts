'use server'

/**
 * Sprint 9.1 — Change password server action.
 *
 * The user must be authenticated. The target user is ALWAYS the
 * currently authenticated user — never trust userId / email from the
 * request body.
 *
 * Flow:
 *   1. Resolve the session via `requireAuth()`.
 *   2. Delegate to `performPasswordChange()` in `lib/auth/session.ts`,
 *      which performs the full validation + persistence + audit chain
 *      and is the unit-tested code path.
 *
 * Returns an `ActionResult` with no sensitive fields. Passwords, hashes,
 * session tokens, and AUTH_SECRET are NEVER returned to the client.
 */

import { requireAuth } from '@/lib/auth/authorize'
import {
  comparePassword,
  hashPassword,
  validatePassword,
} from '@/lib/auth/password'
import { performPasswordChange } from '@/lib/auth/session'
import type { ActionResult } from '@/lib/auth/action-helpers'

export type ChangePasswordFailureCode =
  | 'UNAUTHENTICATED'
  | 'USER_NOT_FOUND'
  | 'USER_DISABLED'
  | 'INCORRECT_CURRENT_PASSWORD'
  | 'WEAK_NEW_PASSWORD'
  | 'CONFIRMATION_MISMATCH'
  | 'SAME_PASSWORD'
  | 'MISSING_FIELDS'
  | 'INTERNAL'

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

export interface ChangePasswordSuccess {
  ok: true
  requireRelogin: true
  changedAt: string
}

function toAction(code: ChangePasswordFailureCode, message: string): ActionResult<ChangePasswordSuccess> {
  return { ok: false, error: { code, message } }
}

export async function changePasswordAction(
  input: ChangePasswordInput,
): Promise<ActionResult<ChangePasswordSuccess>> {
  const auth = await requireAuth()
  if (!auth.ok) {
    return { ok: false, error: { code: auth.code, message: auth.message } }
  }
  const ctx = auth.data

  const result = await performPasswordChange({
    ctx: { userId: ctx.userId, organizationId: ctx.organizationId },
    currentPassword: input?.currentPassword,
    newPassword: input?.newPassword,
    confirmPassword: input?.confirmPassword,
    validate: validatePassword,
    compare: comparePassword,
    hash: hashPassword,
  })

  if (result.ok) {
    return {
      ok: true,
      data: {
        ok: true,
        requireRelogin: result.data.requireRelogin,
        changedAt: result.data.changedAt,
      },
    }
  }
  return toAction(result.code as ChangePasswordFailureCode, result.message)
}
