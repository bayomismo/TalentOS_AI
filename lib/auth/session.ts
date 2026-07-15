/**
 * Sprint 9 — Session utilities.
 *
 * PART 4: secure session management.
 *   - Auth.js JWT strategy with HTTPOnly + Secure + SameSite cookies
 *   - 8-hour session max age
 *   - Per-request DB re-validation in `requireAuth()` (catches password
 *     changes and disables within one DB read)
 *   - Session record in `AuthSession` so ADMIN can revoke individual
 *     sessions and the Security settings page can list active sessions
 *
 * PART 18: changing a user's password bumps `passwordChangedAt`, which
 * invalidates all existing JWTs at the next request.
 */

import { db } from '@/lib/db'
import { createHash } from 'crypto'
import { recordAuditLog } from './audit'

/**
 * Hash a session token for at-rest storage. Same scheme as invitation
 * tokens (SHA-256) — keeps the codebase uniform.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface CreateSessionInput {
  userId: string
  sessionToken: string
  jwtId?: string | null
  userAgent?: string | null
  ipAddress?: string | null
  expiresAt: Date
}

/**
 * Persist a session record. Called from the Auth.js events flow on
 * successful sign-in.
 */
export async function createSessionRecord(input: CreateSessionInput) {
  return db.authSession.create({
    data: {
      userId: input.userId,
      sessionTokenHash: hashSessionToken(input.sessionToken),
      jwtId: input.jwtId ?? null,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      expiresAt: input.expiresAt,
    },
  })
}

/**
 * Lists active sessions for a user. Used in the Security settings page.
 */
export async function listActiveSessions(userId: string) {
  return db.authSession.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastUsedAt: 'desc' },
  })
}

/**
 * Revokes a single session. Only the session owner or an ADMIN can
 * revoke. Used in the Security settings page and for password changes.
 */
export async function revokeSession(sessionId: string, byUserId: string) {
  const session = await db.authSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  })
  await recordAuditLog({
    organizationId: null,
    actorId: byUserId,
    action: 'SESSION_REVOKED',
    targetType: 'session',
    targetId: session.id,
    outcome: 'success',
    metadata: { sessionOwnerId: session.userId },
  })
  return session
}

/**
 * Revokes ALL active sessions for a user. Called when:
 *   - password is changed (PART 18)
 *   - user is disabled
 *   - user explicitly clicks "Sign out everywhere"
 */
export async function revokeAllSessionsForUser(userId: string, byUserId: string) {
  const result = await db.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  await recordAuditLog({
    organizationId: null,
    actorId: byUserId,
    action: 'SESSION_REVOKED',
    targetType: 'user',
    targetId: userId,
    outcome: 'success',
    metadata: { reason: 'revoke_all', count: result.count },
  })
  return result
}

/**
 * Changes a user's password and invalidates all their active sessions
 * by bumping `passwordChangedAt` and revoking all `AuthSession` rows.
 * Caller MUST already have verified the current password.
 */
export async function changePassword(input: {
  userId: string
  newPasswordHash: string
  byUserId: string
  reason: 'user_self' | 'admin_reset'
}) {
  await db.$transaction([
    db.user.update({
      where: { id: input.userId },
      data: { passwordHash: input.newPasswordHash, passwordChangedAt: new Date() },
    }),
    db.authSession.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ])
  await recordAuditLog({
    organizationId: null,
    actorId: input.byUserId,
    action: 'PASSWORD_CHANGED',
    targetType: 'user',
    targetId: input.userId,
    outcome: 'success',
    metadata: { reason: input.reason },
  })
}

/**
 * Sprint 9.1 — full self-service password change for the currently
 * authenticated user. Performs current-password verification, new-password
 * validation, confirmation match, same-as-current check, hashing,
 * atomic persistence + session revocation, and audit logging.
 *
 * The caller is expected to have already resolved the authenticated user
 * (via `requireAuth()` in a server action, or directly in a script). The
 * target user is ALWAYS the one passed in `ctx.userId` — never a value
 * from the request body.
 */
export interface PerformPasswordChangeInput {
  ctx: { userId: string; organizationId: string }
  currentPassword: string
  newPassword: string
  confirmPassword: string
  validate: (plain: string) => { ok: true } | { ok: false; reason: string }
  compare: (plain: string, hash: string) => Promise<boolean>
  hash: (plain: string) => Promise<string>
}

export type PerformPasswordChangeResult =
  | { ok: true; data: { requireRelogin: true; changedAt: string } }
  | {
      ok: false
      code:
        | 'MISSING_FIELDS'
        | 'USER_NOT_FOUND'
        | 'USER_DISABLED'
        | 'INCORRECT_CURRENT_PASSWORD'
        | 'WEAK_NEW_PASSWORD'
        | 'CONFIRMATION_MISMATCH'
        | 'SAME_PASSWORD'
        | 'INTERNAL'
      message: string
    }

export async function performPasswordChange(
  input: PerformPasswordChangeInput,
): Promise<PerformPasswordChangeResult> {
  // 1. Input shape guard
  if (
    typeof input.currentPassword !== 'string' ||
    typeof input.newPassword !== 'string' ||
    typeof input.confirmPassword !== 'string' ||
    input.currentPassword.length === 0 ||
    input.newPassword.length === 0 ||
    input.confirmPassword.length === 0
  ) {
    return { ok: false, code: 'MISSING_FIELDS', message: 'All password fields are required.' }
  }

  // 2. Fetch the user
  const user = await db.user.findUnique({
    where: { id: input.ctx.userId },
    select: {
      id: true,
      passwordHash: true,
      disabledAt: true,
      organizationId: true,
    },
  })
  if (!user) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'Account not found.' }
  }
  if (user.disabledAt) {
    return { ok: false, code: 'USER_DISABLED', message: 'Your account is disabled. Contact your administrator.' }
  }
  if (!user.passwordHash) {
    return {
      ok: false,
      code: 'INCORRECT_CURRENT_PASSWORD',
      message: 'Current password is incorrect.',
    }
  }

  // 3. Verify current password
  const currentOk = await input.compare(input.currentPassword, user.passwordHash)
  if (!currentOk) {
    await recordAuditLog({
      organizationId: input.ctx.organizationId,
      actorId: input.ctx.userId,
      action: 'PASSWORD_CHANGED',
      targetType: 'user',
      targetId: input.ctx.userId,
      outcome: 'failure',
      reason: 'incorrect_current_password',
      metadata: {},
    })
    return { ok: false, code: 'INCORRECT_CURRENT_PASSWORD', message: 'Current password is incorrect.' }
  }

  // 4. Validate new password
  const validation = input.validate(input.newPassword)
  if (!validation.ok) {
    return {
      ok: false,
      code: 'WEAK_NEW_PASSWORD',
      message: 'Your new password does not meet the password requirements.',
    }
  }

  // 5. Confirmation match
  if (input.newPassword !== input.confirmPassword) {
    return {
      ok: false,
      code: 'CONFIRMATION_MISMATCH',
      message: 'New password and confirmation do not match.',
    }
  }

  // 6. Must differ from current
  if (input.newPassword === input.currentPassword) {
    return {
      ok: false,
      code: 'SAME_PASSWORD',
      message: 'Your new password must be different from your current password.',
    }
  }

  // 7. Persist atomically
  const newHash = await input.hash(input.newPassword)
  try {
    await changePassword({
      userId: input.ctx.userId,
      newPasswordHash: newHash,
      byUserId: input.ctx.userId,
      reason: 'user_self',
    })
  } catch (err) {
    await recordAuditLog({
      organizationId: input.ctx.organizationId,
      actorId: input.ctx.userId,
      action: 'PASSWORD_CHANGED',
      targetType: 'user',
      targetId: input.ctx.userId,
      outcome: 'failure',
      reason: 'persistence_error',
      metadata: {},
    }).catch(() => {
      /* best-effort */
    })
    if (process.env.NODE_ENV === 'production') {
      return {
        ok: false,
        code: 'INTERNAL',
        message: 'We could not change your password. Please try again.',
      }
    }
    return {
      ok: false,
      code: 'INTERNAL',
      message: err instanceof Error ? err.message : 'Internal error',
    }
  }

  return {
    ok: true,
    data: { requireRelogin: true, changedAt: new Date().toISOString() },
  }
}
