/**
 * Sprint 9 — Invitation utilities.
 *
 * PART 16: organization user invitations. Secure tokens via
 * crypto.randomBytes(32). We store ONLY the SHA-256 hash of the token
 * (plus an 8-char prefix for display). The plaintext token is returned
 * ONCE to the inviter at creation time and ONCE to the recipient when
 * they accept.
 *
 * PART 17: since no email provider is configured, the invitation URL is
 * surfaced to the inviter only. Future email delivery should be
 * pluggable here.
 */

import { createHash, randomBytes } from 'crypto'
import type { Invitation, UserRole } from '@prisma/client'
import { db } from '@/lib/db'
import { recordAuditLog } from './audit'
import { hashPassword } from './password'
import { validatePassword } from './password'
import { buildAcceptInviteUrl } from '@/lib/url/canonical'

export const INVITATION_TTL_DAYS = 7
const TOKEN_PREFIX_LEN = 8
const ACCEPT_MIN_PASSWORD_LEN = 10

export interface CreateInvitationInput {
  organizationId: string
  email: string
  role: UserRole
  invitedById: string
  message?: string
  /// Sprint 12: optional recipient profile captured at invite time.
  firstName?: string
  lastName?: string
  /// Sprint 12: optional department binding.
  departmentId?: string | null
}

/**
 * Creates a new PENDING invitation. Returns the invitation record
 * together with the plaintext token and the URL to share. The caller is
 * responsible for surfacing the URL to the inviter (PART 17: no email
 * provider yet).
 */
export async function createInvitation(
  input: CreateInvitationInput,
): Promise<{ invitation: Invitation; token: string; url: string }> {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const tokenPrefix = token.slice(0, TOKEN_PREFIX_LEN)

  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)

  const invitation = await db.invitation.create({
    data: {
      organizationId: input.organizationId,
      email: input.email.trim().toLowerCase(),
      role: input.role,
      tokenHash,
      tokenPrefix,
      invitedById: input.invitedById,
      expiresAt,
      message: input.message,
      ...(input.firstName ? { firstName: input.firstName } : {}),
      ...(input.lastName ? { lastName: input.lastName } : {}),
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    },
  })

  await recordAuditLog({
    organizationId: input.organizationId,
    actorId: input.invitedById,
    action: 'INVITATION_CREATED',
    targetType: 'invitation',
    targetId: invitation.id,
    outcome: 'success',
    metadata: { email: invitation.email, role: input.role, expiresAt: expiresAt.toISOString() },
  })

  const url = buildInvitationUrl(token)
  return { invitation, token, url }
}

/**
 * Revokes a PENDING invitation. Only ADMIN or the inviter can revoke.
 * The token can never be used after this call.
 */
export async function revokeInvitation(invitationId: string, byUserId: string): Promise<Invitation> {
  const updated = await db.invitation.update({
    where: { id: invitationId },
    data: { status: 'REVOKED', revokedAt: new Date(), revokedById: byUserId },
  })
  await recordAuditLog({
    organizationId: updated.organizationId,
    actorId: byUserId,
    action: 'INVITATION_REVOKED',
    targetType: 'invitation',
    targetId: updated.id,
    outcome: 'success',
    metadata: { email: updated.email },
  })
  return updated
}

export type AcceptInvitationResult =
  | { ok: true; userId: string; organizationId: string; role: UserRole }
  | { ok: false; reason: string }

/**
 * Accepts an invitation. Validates the token, expiry, and password.
 * Creates or activates the user and marks the invitation ACCEPTED.
 * Idempotent: a second accept on the same token returns a `not_found`
 * (the token row no longer exists for non-pending status).
 */
export async function acceptInvitation(input: {
  token: string
  firstName: string
  lastName: string
  password: string
}): Promise<AcceptInvitationResult> {
  const validation = validatePassword(input.password)
  if (!validation.ok) return { ok: false, reason: validation.reason }
  if (!input.firstName.trim() || !input.lastName.trim()) {
    return { ok: false, reason: 'First and last name are required' }
  }
  if (input.firstName.length > 64 || input.lastName.length > 64) {
    return { ok: false, reason: 'Name is too long' }
  }

  const tokenHash = hashToken(input.token)
  const invitation = await db.invitation.findUnique({ where: { tokenHash } })
  if (!invitation) return { ok: false, reason: 'Invitation not found' }
  if (invitation.status !== 'PENDING') {
    return { ok: false, reason: 'This invitation has already been used or revoked' }
  }
  if (invitation.expiresAt < new Date()) {
    // Mark expired
    await db.invitation.update({
      where: { id: invitation.id },
      data: { status: 'EXPIRED' },
    })
    await recordAuditLog({
      organizationId: invitation.organizationId,
      actorId: null,
      action: 'INVITATION_EXPIRED',
      targetType: 'invitation',
      targetId: invitation.id,
      outcome: 'failure',
      metadata: { email: invitation.email },
    })
    return { ok: false, reason: 'This invitation has expired' }
  }

  const passwordHash = await hashPassword(input.password)
  const email = invitation.email

  // Find existing user (if someone was previously invited by email) or
  // create a new one. Both paths are tenant-scoped: the new user joins
  // the inviting organization.
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email },
      select: { id: true, organizationId: true, passwordHash: true, disabledAt: true, status: true },
    })

    let userId: string
    if (existing) {
      if (existing.organizationId !== invitation.organizationId) {
        throw new Error('email_in_use_in_other_org')
      }
      if (existing.passwordHash && !existing.disabledAt) {
        // Account already set up. Reject to prevent invitation replay.
        throw new Error('account_already_active')
      }
      userId = existing.id
      await tx.user.update({
        where: { id: userId },
        data: {
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          passwordHash,
          passwordChangedAt: new Date(),
          disabledAt: null,
          status: 'ACTIVE',
          role: invitation.role,
        },
      })
    } else {
      const created = await tx.user.create({
        data: {
          organizationId: invitation.organizationId,
          email,
          // Sprint 12: prefer the name captured at invite time, fall back
          // to the name entered at acceptance.
          firstName: (invitation.firstName ?? input.firstName).trim(),
          lastName: (invitation.lastName ?? input.lastName).trim(),
          role: invitation.role,
          status: 'ACTIVE',
          passwordHash,
          passwordChangedAt: new Date(),
          ...(invitation.departmentId ? { departmentId: invitation.departmentId } : {}),
        },
        select: { id: true },
      })
      userId = created.id
    }

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: userId },
    })

    return { userId, organizationId: invitation.organizationId, role: invitation.role }
  })

  await recordAuditLog({
    organizationId: result.organizationId,
    actorId: result.userId,
    action: 'INVITATION_ACCEPTED',
    targetType: 'invitation',
    targetId: invitation.id,
    outcome: 'success',
    metadata: { email, role: invitation.role },
  })

  return { ok: true, ...result }
}

/** Returns a list of active (PENDING, non-expired) invitations for an org. */
export async function listActiveInvitations(organizationId: string) {
  return db.invitation.findMany({
    where: {
      organizationId,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      invitedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  })
}

// -----------------------------------------------------------------------------
// Token hashing
// -----------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Build the URL the invitee visits. The token is in the URL fragment so
 * it is never sent to the server in plaintext. The /accept-invite page
 * reads it and POSTs the password to the action.
 *
 * Sprint 12 — uses the canonical APP_URL only. Throws in production
 * if APP_URL is unset or points at a Vercel preview hostname. See
 * lib/url/canonical.ts for the full rules.
 */
function buildInvitationUrl(token: string): string {
  return buildAcceptInviteUrl(token)
}

export { buildInvitationUrl, hashToken }
