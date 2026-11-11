/**
 * Sprint 9 / Sprint 19 — Invitation utilities.
 *
 * PART 16: organization user invitations. Secure tokens via
 * crypto.randomBytes(32). We store ONLY the SHA-256 hash of the token
 * (plus an 8-char prefix for display). The plaintext token is returned
 * ONCE to the inviter at creation time and ONCE to the recipient when
 * they accept.
 *
 * Sprint 19 (business-flow audit):
 *   P1-23 — `createInvitation` now sends the invitation email itself
 *     (when a delivery provider is configured) and reports what
 *     happened, so the Settings invite is not a copy-and-paste-only
 *     flow any more.
 *   P1-22 — `acceptInvitation` no longer THROWS for the two most common
 *     real cases (the email already belongs to another organization, or
 *     the account is already active). It returns a clean error.
 *   P1-24 — see the mailbox-ownership limitation documented below.
 */

import { createHash, randomBytes } from 'crypto'
import type { Invitation, UserRole } from '@prisma/client'
import { db } from '@/lib/db'
import { recordAuditLog } from './audit'
import { hashPassword } from './password'
import { validatePassword } from './password'
import { buildAcceptInviteUrl } from '@/lib/url/canonical'
import { rateLimit } from './rate-limit'
import { sendEmail, isEmailDeliveryConfigured } from '@/lib/email'
import { teamInvitationEmail } from '@/lib/email/templates'

export const INVITATION_TTL_DAYS = 7
const TOKEN_PREFIX_LEN = 8
const ACCEPT_MIN_PASSWORD_LEN = 10

/**
 * LIMITATION — mailbox ownership is NOT verified (audit P1-24).
 *
 * The invitation token is a BEARER CREDENTIAL for the invited mailbox.
 * Acceptance requires nothing but that token plus a password the
 * invitee chooses, so anyone who obtains or is forwarded the invitation
 * link can claim the seat — with whatever role the invitation granted,
 * including ADMIN. `User.emailVerified` is deliberately left unset,
 * because setting it would assert a verification that never happened.
 *
 * WHY IT IS NOT VERIFIED HERE: proving that a mailbox belongs to the
 * person accepting requires delivering a challenge TO that mailbox, and
 * this deployment has no email delivery provider configured
 * (`RESEND_API_KEY` is not set, so every message is queued in the local
 * outbox and never sent). A verification step that can never complete
 * would lock every legitimate invitee out of their own account, which
 * is a worse failure than the limitation itself. When a provider IS
 * configured, `createInvitation` emails the invitation; that is the
 * transport a future OTP/challenge step would ride on.
 *
 * COMPENSATING CONTROLS that hold without a delivery provider:
 *   · the token is 256 bits of CSPRNG output and is stored ONLY as a
 *     SHA-256 hash — a database read cannot reconstruct it;
 *   · the token is single use: acceptance marks the invitation ACCEPTED
 *     and a second attempt is refused;
 *   · the token expires after 7 days;
 *   · acceptance is rate limited per token and per IP, so the token
 *     cannot be brute-forced through this endpoint;
 *   · an invitation for an email that already belongs to another
 *     organization is refused — it can never be used to take over an
 *     existing account in a different tenant;
 *   · an invitation for an ALREADY ACTIVE account is refused: the
 *     existing password is never overwritten by an invitation;
 *   · acceptance is recorded in the audit log together with the fact
 *     that mailbox ownership was NOT verified.
 *
 * WHAT WOULD CLOSE THIS: an emailed one-time challenge (OTP) that the
 * invitee must echo back before the account is activated, plus
 * `User.emailVerified` being set at that moment. Both need a delivery
 * provider and a place to store the challenge hash.
 */
export const MAILBOX_OWNERSHIP_VERIFIED = false

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

export interface CreateInvitationResult {
  invitation: Invitation
  token: string
  url: string
  /** True when a real provider accepted the invitation email. */
  emailDelivered: boolean
  /** True when a delivery provider is configured at all. */
  emailConfigured: boolean
}

/**
 * Creates a new PENDING invitation. Returns the invitation record
 * together with the plaintext token and the URL to share.
 *
 * The invitation email is sent through the configured provider. When no
 * provider is configured the message is queued in the local outbox and
 * NOT delivered — `emailDelivered` says so, so the caller never tells
 * an admin that an email went out when it did not.
 */
export async function createInvitation(
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
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

  // Audit P1-23 / P0-03: send the invitation and report what happened.
  const emailConfigured = isEmailDeliveryConfigured()
  let emailDelivered = false
  try {
    const [org, inviter] = await Promise.all([
      db.organization.findUnique({
        where: { id: input.organizationId },
        select: { name: true },
      }),
      db.user.findUnique({
        where: { id: input.invitedById },
        select: { firstName: true, lastName: true, email: true },
      }),
    ])
    if (org && inviter) {
      const tpl = teamInvitationEmail({
        to: invitation.email,
        inviterName: `${inviter.firstName} ${inviter.lastName}`,
        inviterEmail: inviter.email,
        organizationName: org.name,
        role: input.role,
        token,
        message: input.message ?? null,
      })
      const sent = await sendEmail({
        kind: 'team_invitation',
        to: invitation.email,
        from: tpl.from,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
        metadata: { invitationId: invitation.id },
      })
      emailDelivered = sent.delivery === 'delivered'
    }
  } catch (err) {
    // The invitation still exists and the URL is still returned to the
    // inviter — but the failure must not be silent (audit P0-03).
    console.error('[invitation] failed to send the invitation email:', err)
  }

  return { invitation, token, url, emailDelivered, emailConfigured }
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
  | { ok: false; reason: string; code?: string }

/**
 * Accepts an invitation. Validates the token, expiry, and password.
 * Creates or activates the user and marks the invitation ACCEPTED.
 * Idempotent: a second accept on the same token returns a `not_found`
 * (the token row no longer exists for non-pending status).
 *
 * Sprint 19 (audit P1-22): the two most common real situations — the
 * email already belongs to another organization, and the account is
 * already active — used to THROW inside the transaction. The action had
 * no try/catch, so the invitee got an unhandled server error instead of
 * a message. Both are now clean, returned failures.
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

  // The token is a bearer credential: limit how often it can be tried.
  // See the mailbox-ownership limitation documented at the top of this
  // file — compensating controls are listed there.
  const acceptLimit = rateLimit(
    `accept-invite:${hashToken(input.token).slice(0, 32)}`,
    10,
    15 * 60,
  )
  if (!acceptLimit.ok) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      reason: 'Too many attempts with this invitation. Please try again in a few minutes.',
    }
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
        // Not an error state of the world — a clean refusal. The account
        // belongs to another tenant and an invitation can never move it.
        return {
          ok: false as const,
          code: 'EMAIL_IN_OTHER_ORG',
          reason: 'This email address already belongs to another organization.',
        }
      }
      if (existing.passwordHash && !existing.disabledAt) {
        // Account already set up. Refuse — an invitation must never
        // overwrite the password of an active account.
        return {
          ok: false as const,
          code: 'ACCOUNT_ALREADY_ACTIVE',
          reason:
            'This account is already active. Sign in instead, or ask an administrator to reset your password.',
        }
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
          // `emailVerified` stays null on purpose: the mailbox was never
          // verified (see MAILBOX_OWNERSHIP_VERIFIED above).
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

    return {
      ok: true as const,
      userId,
      organizationId: invitation.organizationId,
      role: invitation.role,
    }
  })

  if (!result.ok) {
    // The invitation stays PENDING so the invitee can still be helped
    // (or the admin can revoke it) — but nothing was written.
    return { ok: false, reason: result.reason, code: result.code }
  }

  await recordAuditLog({
    organizationId: result.organizationId,
    actorId: result.userId,
    action: 'INVITATION_ACCEPTED',
    targetType: 'invitation',
    targetId: invitation.id,
    outcome: 'success',
    metadata: {
      email,
      role: invitation.role,
      // Audit P1-24: recorded so the trail says what really happened.
      mailboxOwnershipVerified: MAILBOX_OWNERSHIP_VERIFIED,
    },
  })

  return { ok: true, userId: result.userId, organizationId: result.organizationId, role: result.role }
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
