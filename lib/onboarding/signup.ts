/**
 * Sprint 13 — Public signup.
 *
 * Creates a brand-new User with no organization, with
 * onboardingStatus = PENDING and onboardingStep = ACCOUNT_CREATED.
 *
 * The user lands in /onboarding/workspace on first login to create
 * their organization.
 *
 * The personal "placeholder" organization is created so that the
 * foreign-key constraint from User.organizationId is satisfied. The
 * placeholder is deleted once the real workspace is provisioned.
 *
 * Security:
 *   - Strong password validation via lib/auth/password
 *   - Email uniqueness check (case-insensitive)
 *   - Password is bcrypt-hashed (NEVER plaintext)
 *   - Password is NEVER returned in the response
 *   - Password is NEVER logged
 *   - Audit metadata contains NO password material
 *   - Rate-limiting is enforced at the route level (see app/signup/_actions.ts)
 */

import 'server-only'
import { db } from '@/lib/db'
import { hashPassword, validatePassword } from '@/lib/auth/password'
import { recordAuditLog } from '@/lib/auth/audit'

export interface SignupInput {
  email: string
  password: string
  firstName: string
  lastName: string
}

export interface SignupResult {
  ok: true
  userId: string
  placeholderOrganizationId: string
  email: string
  firstName: string
  lastName: string
}
export interface SignupError {
  ok: false
  code: 'INVALID_INPUT' | 'INVALID_EMAIL' | 'WEAK_PASSWORD' | 'EMAIL_TAKEN' | 'INTERNAL'
  message: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function placeholderOrgSlug(): string {
  return `personal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export async function publicSignup(input: SignupInput): Promise<SignupResult | SignupError> {
  const email = (input.email ?? '').trim().toLowerCase()
  const firstName = (input.firstName ?? '').trim()
  const lastName = (input.lastName ?? '').trim()
  const password = input.password ?? ''

  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, code: 'INVALID_EMAIL', message: 'Please enter a valid email address.' }
  }
  if (!firstName || firstName.length > 64) {
    return { ok: false, code: 'INVALID_INPUT', message: 'First name is required.' }
  }
  if (!lastName || lastName.length > 64) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Last name is required.' }
  }
  if (!password) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Password is required.' }
  }
  const validation = validatePassword(password)
  if (!validation.ok) {
    return { ok: false, code: 'WEAK_PASSWORD', message: validation.reason }
  }

  // Check email uniqueness
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    return { ok: false, code: 'EMAIL_TAKEN', message: 'An account with this email already exists.' }
  }

  const passwordHash = await hashPassword(password)

  try {
    const result = await db.$transaction(async (tx) => {
      // Create the personal placeholder organization (will be
      // replaced once the user provisions a real workspace).
      const placeholder = await tx.organization.create({
        data: {
          name: `${firstName} ${lastName}'s Workspace`,
          slug: placeholderOrgSlug(),
          onboardingStatus: 'PENDING',
        },
      })
      const u = await tx.user.create({
        data: {
          email,
          firstName,
          lastName,
          passwordHash,
          passwordChangedAt: new Date(),
          role: 'ADMIN', // becomes ADMIN of their future org on provisioning
          status: 'ACTIVE',
          organizationId: placeholder.id,
          onboardingStatus: 'PENDING',
          onboardingStep: 'ACCOUNT_CREATED',
        },
      })
      return { userId: u.id, placeholderOrganizationId: placeholder.id }
    })

    // Audit (NO password material)
    await recordAuditLog({
      organizationId: result.placeholderOrganizationId,
      actorId: result.userId,
      action: 'USER_SIGNED_UP' as never,
      targetType: 'user',
      targetId: result.userId,
      outcome: 'success',
      metadata: {
        emailDomain: email.split('@')[1] ?? null,
        // First/last name omitted from audit metadata for PII safety
      } as any,
    }).catch(() => null)

    return {
      ok: true,
      userId: result.userId,
      placeholderOrganizationId: result.placeholderOrganizationId,
      email,
      firstName,
      lastName,
    }
  } catch (err) {
    return { ok: false, code: 'INTERNAL', message: 'Sign-up failed. Please try again.' }
  }
}
