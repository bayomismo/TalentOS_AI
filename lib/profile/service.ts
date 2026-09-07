/**
 * Sprint 13 — Profile service.
 *
 * Reads and updates the authenticated user's own profile. Never
 * trusts a userId from the browser; always derives it from
 * requireAuth() / ctx.userId.
 */

import 'server-only'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'

export interface Profile {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  jobTitle: string | null
  timezone: string | null
  bio: string | null
  phone: string | null
  location: string | null
  avatarUrl: string | null
  role: string
  status: string
  lastLoginAt: string | null
  organizationId: string
  organizationName: string
  organizationSlug: string
}

export interface UpdateProfileInput {
  firstName?: string
  lastName?: string
  jobTitle?: string | null
  timezone?: string | null
  bio?: string | null
  phone?: string | null
  location?: string | null
}

const TEXT_MAX = 64
const BIO_MAX = 2000

export async function getOwnProfile(ctx: { userId: string; organizationId: string }): Promise<Profile | null> {
  const u = await db.user.findFirst({
    where: { id: ctx.userId, organizationId: ctx.organizationId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      timezone: true,
      bio: true,
      phone: true,
      location: true,
      avatarUrl: true,
      role: true,
      status: true,
      lastLoginAt: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
  })
  if (!u) return null
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    fullName: `${u.firstName} ${u.lastName}`.trim(),
    jobTitle: u.jobTitle ?? null,
    timezone: u.timezone ?? null,
    bio: u.bio ?? null,
    phone: u.phone ?? null,
    location: u.location ?? null,
    avatarUrl: u.avatarUrl ?? null,
    role: u.role,
    status: u.status,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    organizationId: u.organization.id,
    organizationName: u.organization.name,
    organizationSlug: u.organization.slug,
  }
}

export interface UpdateProfileResult {
  ok: boolean
  error?: { code: string; message: string }
}

export async function updateOwnProfile(
  ctx: { userId: string; organizationId: string },
  input: UpdateProfileInput,
): Promise<UpdateProfileResult> {
  const data: Record<string, unknown> = {}

  if (input.firstName !== undefined) {
    const v = input.firstName.trim()
    if (v.length < 1 || v.length > TEXT_MAX) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'First name must be 1-64 characters.' } }
    }
    data.firstName = v
  }
  if (input.lastName !== undefined) {
    const v = input.lastName.trim()
    if (v.length < 1 || v.length > TEXT_MAX) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'Last name must be 1-64 characters.' } }
    }
    data.lastName = v
  }
  if (input.jobTitle !== undefined) {
    const v = input.jobTitle?.trim() || null
    if (v && v.length > TEXT_MAX) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'Job title is too long.' } }
    }
    data.jobTitle = v
  }
  if (input.timezone !== undefined) {
    data.timezone = input.timezone?.trim() || null
  }
  if (input.bio !== undefined) {
    const v = input.bio?.trim() || null
    if (v && v.length > BIO_MAX) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: `Bio must be ${BIO_MAX} characters or fewer.` } }
    }
    data.bio = v
  }
  if (input.phone !== undefined) {
    const v = input.phone?.trim() || null
    if (v && v.length > 32) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Phone is too long.' } }
    data.phone = v
  }
  if (input.location !== undefined) {
    const v = input.location?.trim() || null
    if (v && v.length > 128) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Location is too long.' } }
    data.location = v
  }

  if (Object.keys(data).length === 0) {
    return { ok: true }
  }

  // Verify the user is in their own org (defense in depth — never
  // trust ctx blindly, always re-check the user exists in that org)
  const exists = await db.user.findFirst({
    where: { id: ctx.userId, organizationId: ctx.organizationId },
    select: { id: true },
  })
  if (!exists) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Profile not found.' } }
  }

  await db.user.update({ where: { id: ctx.userId }, data })
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'PROFILE_UPDATED' as never,
    targetType: 'user',
    targetId: ctx.userId,
    outcome: 'success',
    metadata: { fields: Object.keys(data) } as any,
  }).catch(() => null)
  return { ok: true }
}
