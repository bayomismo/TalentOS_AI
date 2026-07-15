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
