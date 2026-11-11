'use server'

/**
 * Sprint 13 — Server actions for signup, onboarding, profile, org.
 *
 * Each action is explicitly an "use server" function. Browser cannot
 * send a trusted userId or organizationId. All server-side derived.
 */

import 'server-only'
import { z } from 'zod'
import { publicSignup } from './signup'
import { provisionWorkspace } from './provision'
import { transitionOnboardingStep, completeOnboarding } from './transitions'
import { requireAuth } from '@/lib/auth/authorize'
import { getOwnProfile, updateOwnProfile } from '@/lib/profile/service'
import { getOwnOrganization, updateOwnOrganization } from '@/lib/organization/service'
import { safeRevalidate } from '@/lib/utils/revalidate'
import { signIn } from '@/lib/auth/auth'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'
import { createInvitation } from '@/lib/auth/invitation'
import { rateLimit } from '@/lib/auth/rate-limit'
import { missingCompanyFields } from './transitions'

// -----------------------------------------------------------------------------
// Signup
// -----------------------------------------------------------------------------

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(128),
  firstName: z.string().min(1).max(64),
  lastName: z.string().min(1).max(64),
})

export async function publicSignupAction(input: unknown): Promise<{ ok: boolean; userId?: string; error?: { code: string; message: string } }> {
  const parsed = signupSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: { code: 'INVALID_INPUT', message: first?.message ?? 'Invalid input' } }
  }
  // Rate-limit by email (to prevent email enumeration) and a global
  // bucket to throttle the signup endpoint.
  const emailBucket = await rateLimit(`signup:email:${parsed.data.email.toLowerCase()}`, 5, 60 * 10)
  if (!emailBucket.ok) {
    return { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many signup attempts for this email. Please try again later.' } }
  }
  const globalBucket = await rateLimit('signup:global', 30, 60 * 10)
  if (!globalBucket.ok) {
    return { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many signups. Please try again in a few minutes.' } }
  }
  const result = await publicSignup(parsed.data)
  if (!result.ok) return { ok: false, error: { code: result.code, message: result.message } }
  return { ok: true, userId: result.userId }
}

/**
 * Sign in immediately after signup. We use Auth.js Credentials
 * signIn. This is server-side and safe; the password is sent to
 * the Auth.js authorize() callback which re-validates with bcrypt.
 */
export async function autoSignInAfterSignup(input: { email: string; password: string }) {
  try {
    await signIn('credentials', {
      email: input.email,
      password: input.password,
      redirect: false,
    })
    return { ok: true as const }
  } catch (err) {
    return { ok: false as const, error: (err as Error).message }
  }
}

// -----------------------------------------------------------------------------
// Onboarding: workspace creation
// -----------------------------------------------------------------------------

const provisionSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().max(48).optional(),
  industry: z.string().max(80).optional().nullable(),
  size: z.string().max(40).optional().nullable(),
  country: z.string().max(80).optional().nullable(),
  timezone: z.string().max(80).optional().nullable(),
})

export async function provisionWorkspaceAction(input: unknown): Promise<{ ok: boolean; organizationId?: string; error?: { code: string; message: string } }> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, error: { code: 'AUTH', message: 'Not signed in.' } }
  const parsed = provisionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input' } }
  }
  const result = await provisionWorkspace({ userId: auth.data.userId }, parsed.data)
  if (!result.ok) return { ok: false, error: { code: result.code, message: result.message } }
  // Mark user step as ORG_CREATED. The transition result is CHECKED:
  // audit P1-21 found callers discarding it with `.catch(() => null)`,
  // which never fires because the transition does not throw — the UI
  // advanced while the stored step did not.
  const step = await transitionOnboardingStep(
    { userId: auth.data.userId, organizationId: result.organizationId },
    'ORG_CREATED',
  )
  if (!step.ok) {
    return { ok: false, error: { code: step.error?.code ?? 'INTERNAL', message: step.error?.message ?? 'Could not advance onboarding.' } }
  }
  safeRevalidate('/onboarding')
  safeRevalidate('/dashboard')
  return { ok: true, organizationId: result.organizationId }
}

// -----------------------------------------------------------------------------
// Onboarding: company setup
// -----------------------------------------------------------------------------

const companySetupSchema = z.object({
  industry: z.string().max(80).optional().nullable(),
  size: z.string().max(40).optional().nullable(),
  country: z.string().max(80).optional().nullable(),
  timezone: z.string().max(80).optional().nullable(),
})

export async function companySetupAction(input: unknown): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, error: { code: 'AUTH', message: 'Not signed in.' } }
  const parsed = companySetupSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input' } }
  }
  // Audit P1-21: every company field was optional, so an organization
  // could be "fully onboarded" with no country, no timezone and no
  // industry — and interview reminders were then scheduled in the wrong
  // timezone. The configuration is now mandatory.
  const missing = missingCompanyFields({
    country: parsed.data.country ?? null,
    timezone: parsed.data.timezone ?? null,
    industry: parsed.data.industry ?? null,
  })
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: 'INCOMPLETE_COMPANY_SETUP',
        message: `Please set ${missing.join(', ')} before continuing.`,
      },
    }
  }
  const r = await updateOwnOrganization(
    { organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role },
    parsed.data,
  )
  if (!r.ok) return { ok: false, error: r.error }
  const step = await transitionOnboardingStep(
    { userId: auth.data.userId, organizationId: auth.data.organizationId },
    'COMPANY_CONFIGURED',
  )
  if (!step.ok) {
    return { ok: false, error: { code: step.error?.code ?? 'INTERNAL', message: step.error?.message ?? 'Could not advance onboarding.' } }
  }
  safeRevalidate('/onboarding')
  return { ok: true }
}

// -----------------------------------------------------------------------------
// Onboarding: invite team
// -----------------------------------------------------------------------------

const inviteTeamSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(64),
  lastName: z.string().min(1).max(64),
  role: z.enum(['ADMIN', 'TA_LEAD', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER', 'VIEWER']),
})

export async function inviteTeamMemberAction(input: unknown): Promise<{
  ok: boolean
  invitationUrl?: string
  /** True when a real provider accepted the invitation email. */
  emailDelivered?: boolean
  /** True when email delivery is not configured at all. */
  emailConfigured?: boolean
  error?: { code: string; message: string }
}> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, error: { code: 'AUTH', message: 'Not signed in.' } }
  const parsed = inviteTeamSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input' } }
  }
  // Reject if user is trying to set someone as ADMIN of a new org
  // unless they are themselves ADMIN (which they are at this point)
  if (auth.data.role !== 'ADMIN') {
    return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Only ADMIN can invite users.' } }
  }
  // Email uniqueness within org
  const existing = await db.user.findFirst({
    where: { email: parsed.data.email.toLowerCase(), organizationId: auth.data.organizationId },
    select: { id: true },
  })
  if (existing) return { ok: false, error: { code: 'EMAIL_TAKEN', message: 'A user with this email already exists.' } }
  const pending = await db.invitation.findFirst({
    where: { email: parsed.data.email.toLowerCase(), organizationId: auth.data.organizationId, status: 'PENDING' },
    select: { id: true },
  })
  if (pending) return { ok: false, error: { code: 'INVITATION_EXISTS', message: 'A pending invitation already exists.' } }

  // Create the invitation. `createInvitation` is the single place that
  // creates an invitation AND sends the invitation email (audit P1-23),
  // so both the onboarding path and the Settings path behave the same.
  const created = await createInvitation({
    organizationId: auth.data.organizationId,
    email: parsed.data.email.toLowerCase(),
    role: parsed.data.role,
    invitedById: auth.data.userId,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
  })
  await recordAuditLog({
    organizationId: auth.data.organizationId,
    actorId: auth.data.userId,
    action: 'INVITATION_SENT' as never,
    targetType: 'invitation',
    targetId: created.invitation.id,
    outcome: 'success',
    metadata: {
      email: parsed.data.email,
      role: parsed.data.role,
      // Audit P0-03: what actually happened to the email.
      emailConfigured: created.emailConfigured,
      emailDelivered: created.emailDelivered,
    } as any,
  }).catch(() => null)

  return {
    ok: true,
    invitationUrl: created.url,
    emailDelivered: created.emailDelivered,
    emailConfigured: created.emailConfigured,
  }
}

export async function skipTeamInviteAction(): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, error: { code: 'AUTH', message: 'Not signed in.' } }
  // The transition result is CHECKED, never discarded (audit P1-21).
  const step = await transitionOnboardingStep(
    { userId: auth.data.userId, organizationId: auth.data.organizationId },
    'TEAM_INVITED',
  )
  if (!step.ok) {
    return { ok: false, error: { code: step.error?.code ?? 'INTERNAL', message: step.error?.message ?? 'Could not advance onboarding.' } }
  }
  safeRevalidate('/onboarding')
  return { ok: true }
}

export async function completeOnboardingAction(): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, error: { code: 'AUTH', message: 'Not signed in.' } }
  const r = await completeOnboarding({ userId: auth.data.userId, organizationId: auth.data.organizationId })
  if (!r.ok) return { ok: false, error: r.error }
  safeRevalidate('/onboarding')
  safeRevalidate('/dashboard')
  safeRevalidate('/settings')
  return { ok: true }
}

// -----------------------------------------------------------------------------
// Profile
// -----------------------------------------------------------------------------

const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(64).optional(),
  lastName: z.string().min(1).max(64).optional(),
  jobTitle: z.string().max(64).nullable().optional(),
  timezone: z.string().max(80).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  location: z.string().max(128).nullable().optional(),
})

export async function getOwnProfileAction(): Promise<{ ok: boolean; data?: any; error?: { code: string; message: string } }> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, error: { code: 'AUTH', message: 'Not signed in.' } }
  const p = await getOwnProfile({ userId: auth.data.userId, organizationId: auth.data.organizationId })
  if (!p) return { ok: false, error: { code: 'NOT_FOUND', message: 'Profile not found.' } }
  return { ok: true, data: p }
}

export async function updateOwnProfileAction(input: unknown): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, error: { code: 'AUTH', message: 'Not signed in.' } }
  const parsed = updateProfileSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input' } }
  }
  const r = await updateOwnProfile({ userId: auth.data.userId, organizationId: auth.data.organizationId }, parsed.data)
  if (!r.ok) return { ok: false, error: r.error }
  safeRevalidate('/settings')
  safeRevalidate('/dashboard')
  return { ok: true }
}

// -----------------------------------------------------------------------------
// Organization (read + update by ADMIN)
// -----------------------------------------------------------------------------

export async function getOwnOrganizationAction(): Promise<{ ok: boolean; data?: any; error?: { code: string; message: string } }> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, error: { code: 'AUTH', message: 'Not signed in.' } }
  const o = await getOwnOrganization({ organizationId: auth.data.organizationId })
  if (!o) return { ok: false, error: { code: 'NOT_FOUND', message: 'Organization not found.' } }
  return { ok: true, data: o }
}

const updateOrganizationSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  industry: z.string().max(80).nullable().optional(),
  size: z.string().max(40).nullable().optional(),
  country: z.string().max(80).nullable().optional(),
  timezone: z.string().max(80).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
})

export async function updateOwnOrganizationAction(input: unknown): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, error: { code: 'AUTH', message: 'Not signed in.' } }
  const parsed = updateOrganizationSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input' } }
  }
  const r = await updateOwnOrganization(
    { organizationId: auth.data.organizationId, userId: auth.data.userId, role: auth.data.role },
    parsed.data,
  )
  if (!r.ok) return { ok: false, error: r.error }
  safeRevalidate('/settings')
  return { ok: true }
}
