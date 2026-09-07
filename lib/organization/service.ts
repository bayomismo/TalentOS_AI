/**
 * Sprint 13 — Organization service.
 *
 * Reads and updates the authenticated tenant's organization.
 * Never trusts an organizationId from the browser.
 */

import 'server-only'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'

export interface OrganizationInfo {
  id: string
  name: string
  slug: string
  industry: string | null
  size: string | null
  country: string | null
  timezone: string | null
  website: string | null
  description: string | null
  logoUrl: string | null
  onboardingStatus: string
  onboardingCompletedAt: string | null
  createdAt: string
  counts: {
    users: number
    departments: number
    hiringRequests: number
    candidates: number
    interviews: number
    offers: number
  }
}

export async function getOwnOrganization(ctx: { organizationId: string }): Promise<OrganizationInfo | null> {
  const o = await db.organization.findUnique({
    where: { id: ctx.organizationId },
  })
  if (!o) return null
  const [
    users, departments, hiringRequests, candidates, interviews, offers,
  ] = await Promise.all([
    db.user.count({ where: { organizationId: ctx.organizationId } }),
    db.department.count({ where: { organizationId: ctx.organizationId } }),
    db.hiringRequest.count({ where: { organizationId: ctx.organizationId } }),
    db.candidate.count({ where: { organizationId: ctx.organizationId } }),
    db.interview.count({ where: { organizationId: ctx.organizationId } }),
    db.offer.count({ where: { organizationId: ctx.organizationId } }),
  ])
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    industry: o.industry,
    size: o.size,
    country: o.country,
    timezone: o.timezone,
    website: o.website,
    description: o.description,
    logoUrl: o.logoUrl,
    onboardingStatus: o.onboardingStatus,
    onboardingCompletedAt: o.onboardingCompletedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    counts: { users, departments, hiringRequests, candidates, interviews, offers },
  }
}

export interface UpdateOrganizationInput {
  name?: string
  industry?: string | null
  size?: string | null
  country?: string | null
  timezone?: string | null
  website?: string | null
  description?: string | null
}

export async function updateOwnOrganization(
  ctx: { organizationId: string; userId: string; role: string },
  input: UpdateOrganizationInput,
): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
  if (ctx.role !== 'ADMIN') {
    return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Only ADMIN can update organization settings.' } }
  }
  const data: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const v = input.name.trim()
    if (v.length < 2 || v.length > 80) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'Organization name must be 2-80 characters.' } }
    }
    data.name = v
  }
  if (input.industry !== undefined) data.industry = input.industry?.trim() || null
  if (input.size !== undefined) data.size = input.size?.trim() || null
  if (input.country !== undefined) data.country = input.country?.trim() || null
  if (input.timezone !== undefined) data.timezone = input.timezone?.trim() || null
  if (input.website !== undefined) {
    const v = input.website?.trim() || null
    if (v && !/^https?:\/\//i.test(v)) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'Website must start with http:// or https://' } }
    }
    data.website = v
  }
  if (input.description !== undefined) {
    const v = input.description?.trim() || null
    if (v && v.length > 2000) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'Description is too long.' } }
    }
    data.description = v
  }
  if (Object.keys(data).length === 0) return { ok: true }
  await db.organization.update({ where: { id: ctx.organizationId }, data })
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'ORGANIZATION_UPDATED' as never,
    targetType: 'organization',
    targetId: ctx.organizationId,
    outcome: 'success',
    metadata: { fields: Object.keys(data) } as any,
  }).catch(() => null)
  return { ok: true }
}
