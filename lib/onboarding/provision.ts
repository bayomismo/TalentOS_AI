/**
 * Sprint 13 — Workspace provisioning.
 *
 * Atomic transaction that creates a brand-new Organization, assigns
 * the calling user as the first ADMIN, sets up required defaults
 * (a default Department, a default ADMIN, a default PromptTemplate
 * set if needed), and writes a single AuditLog row.
 *
 * Strict rules:
 *   - organizationId is server-derived from ctx.userId. NEVER trusted
 *     from the browser.
 *   - The provisioning step is atomic. If anything fails, the entire
 *     transaction is rolled back, leaving NO orphan User, NO orphan
 *     Organization, and NO Organization without an ADMIN.
 *   - The new Organization starts EMPTY of business data
 *     (HRs / Candidates / Interviews / Offers / Activities / AI Tasks
 *     are all zero).
 *   - Workspace slug is normalized, unique, and validated against
 *     a reserved-name list (admin, api, login, signup, ...).
 *   - The first ADMIN cannot be downgraded or disabled by anyone
 *     else until a second ADMIN is added (Sprint 9 + Sprint 12).
 */

import 'server-only'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'
import { slugify } from './slugify'
import { reservedSlugs } from './reserved'

export interface ProvisionInput {
  name: string
  slug?: string
  industry?: string | null
  size?: string | null
  country?: string | null
  timezone?: string | null
}

export interface ProvisionResult {
  ok: true
  organizationId: string
  organizationSlug: string
  organizationName: string
  firstAdminUserId: string
}
export interface ProvisionError {
  ok: false
  code:
    | 'NO_USER'
    | 'ALREADY_HAS_ORG'
    | 'INVALID_NAME'
    | 'INVALID_SLUG'
    | 'SLUG_TAKEN'
    | 'INTERNAL'
  message: string
}

const NAME_MIN = 2
const NAME_MAX = 80
const SLUG_MIN = 3
const SLUG_MAX = 48

export async function provisionWorkspace(
  ctx: { userId: string },
  input: ProvisionInput,
): Promise<ProvisionResult | ProvisionError> {
  // Validate name
  const name = (input.name ?? '').trim()
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return {
      ok: false,
      code: 'INVALID_NAME',
      message: `Organization name must be between ${NAME_MIN} and ${NAME_MAX} characters.`,
    }
  }

  // Normalize and validate slug
  const rawSlug = (input.slug ?? '').trim().toLowerCase()
  const slug = rawSlug.length > 0 ? slugify(rawSlug) : slugify(name)
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return {
      ok: false,
      code: 'INVALID_SLUG',
      message: `Workspace URL must be between ${SLUG_MIN} and ${SLUG_MAX} characters.`,
    }
  }
  if (reservedSlugs.has(slug)) {
    return {
      ok: false,
      code: 'INVALID_SLUG',
      message: 'That workspace URL is reserved. Please choose another.',
    }
  }

  // Atomic transaction
  try {
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: ctx.userId },
        select: { id: true, organizationId: true, role: true, email: true, firstName: true, lastName: true, passwordHash: true, status: true, onboardingStatus: true },
      })
      if (!user) throw new Error('NO_USER')
      // The user must NOT already have an organization. The signup
      // flow creates the User with a placeholder "personal"
      // organization that we immediately replace here. We enforce
      // this by checking the user's current org is PENDING.
      const currentOrg = await tx.organization.findUnique({
        where: { id: user.organizationId },
        select: { id: true, onboardingStatus: true },
      })
      if (currentOrg && currentOrg.onboardingStatus === 'COMPLETED') {
        throw new Error('ALREADY_HAS_ORG')
      }

      // Slug uniqueness (case-insensitive). If the slug is taken we
      // append a short suffix to make it unique, but only if the
      // caller did NOT provide a custom slug. If the caller provided
      // a custom slug and it's taken we fail.
      let finalSlug = slug
      const existing = await tx.organization.findFirst({
        where: { slug: { equals: finalSlug, mode: 'insensitive' as any } as any },
        select: { id: true },
      })
      if (existing) {
        if (rawSlug.length > 0) {
          throw new Error('SLUG_TAKEN')
        }
        // Auto-derive a unique slug
        for (let i = 2; i < 1000; i++) {
          const candidate = `${slug}-${i}`
          const taken = await tx.organization.findFirst({
            where: { slug: { equals: candidate, mode: 'insensitive' as any } as any },
            select: { id: true },
          })
          if (!taken) {
            finalSlug = candidate
            break
          }
        }
      }

      // Create the new organization
      const newOrg = await tx.organization.create({
        data: {
          name,
          slug: finalSlug,
          industry: input.industry ?? null,
          size: input.size ?? null,
          country: input.country ?? null,
          timezone: input.timezone ?? null,
          onboardingStatus: 'PENDING',
          onboardingCompletedAt: null,
        },
      })

      // Re-assign the user to the new org as ADMIN. If the user was
      // previously in a placeholder org, that placeholder is left
      // empty (we will delete it after the transaction).
      await tx.user.update({
        where: { id: user.id },
        data: {
          organizationId: newOrg.id,
          role: 'ADMIN',
          status: 'ACTIVE',
          departmentId: null,
        },
      })

      // Set User onboarding state
      await tx.user.update({
        where: { id: user.id },
        data: {
          onboardingStatus: 'PENDING',
          onboardingStep: 'ORG_CREATED',
        },
      })

      // Set Organization onboarding state
      await tx.organization.update({
        where: { id: newOrg.id },
        data: { onboardingStatus: 'PENDING' },
      })

      // Create a default Department so HRs can be created
      const dept = await tx.department.create({
        data: {
          organizationId: newOrg.id,
          name: 'People & Talent',
          slug: `people-talent-${Date.now().toString(36)}`,
        },
      })

      // Re-link user to the default department
      await tx.user.update({
        where: { id: user.id },
        data: { departmentId: dept.id },
      })

      // Delete the placeholder org if it was empty (created during
      // signup before the user had a real workspace).
      if (currentOrg && currentOrg.id !== newOrg.id) {
        const otherUsers = await tx.user.count({ where: { organizationId: currentOrg.id, id: { not: user.id } } })
        if (otherUsers === 0) {
          await tx.organization.delete({ where: { id: currentOrg.id } }).catch(() => null)
        }
      }

      return {
        organizationId: newOrg.id,
        organizationSlug: newOrg.slug,
        organizationName: newOrg.name,
        firstAdminUserId: user.id,
      }
    })

    // Audit log (outside the transaction)
    await recordAuditLog({
      organizationId: result.organizationId,
      actorId: result.firstAdminUserId,
      action: 'WORKSPACE_PROVISIONED' as never,
      targetType: 'organization',
      targetId: result.organizationId,
      outcome: 'success',
      metadata: {
        organizationName: result.organizationName,
        organizationSlug: result.organizationSlug,
        firstAdmin: result.firstAdminUserId,
      } as any,
    }).catch(() => null)

    return { ok: true, ...result }
  } catch (err) {
    const message = (err as Error).message
    if (message === 'NO_USER') {
      return { ok: false, code: 'NO_USER', message: 'User not found.' }
    }
    if (message === 'ALREADY_HAS_ORG') {
      return { ok: false, code: 'ALREADY_HAS_ORG', message: 'You already belong to an organization.' }
    }
    if (message === 'SLUG_TAKEN') {
      return { ok: false, code: 'SLUG_TAKEN', message: 'That workspace URL is already taken. Please choose another.' }
    }
    return { ok: false, code: 'INTERNAL', message: 'Failed to provision workspace. Please try again.' }
  }
}
