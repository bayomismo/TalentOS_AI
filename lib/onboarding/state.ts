/**
 * Sprint 13 — Onboarding state machine.
 *
 * The first ADMIN of a freshly created organization goes through a
 * deterministic onboarding flow:
 *
 *   ACCOUNT_CREATED (auth.signUp finished, but no org yet)
 *     → ORG_PENDING         (entered /onboarding/workspace form)
 *     → ORG_CREATED         (workspace provisioning transaction committed)
 *     → COMPANY_CONFIGURED  (industry / size / country / timezone saved)
 *     → TEAM_INVITED        (optional: at least one PENDING invitation)
 *     → COMPLETED           (User.onboardingStatus = COMPLETED, all
 *                            operational pages reachable, dashboard
 *                            unlocked)
 *
 * A user is allowed into the app (no onboarding redirect) when BOTH:
 *   - User.onboardingStatus === COMPLETED
 *   - Organization.onboardingStatus === COMPLETED
 *
 * If the user is on a step earlier than the requested route, the
 * middleware/route handler redirects to the appropriate step.
 *
 * Backward compatibility:
 *   - The 20260720000002_sprint13_onboarding migration backfills every
 *     existing User and Organization to COMPLETED, so existing
 *     production users are NOT forced through onboarding.
 */

import { db } from '@/lib/db'
import type { OnboardingStatus, OnboardingStep } from '@prisma/client'

export interface OnboardingSnapshot {
  userStatus: OnboardingStatus
  userStep: OnboardingStep
  organizationStatus: OnboardingStatus
  organizationId: string | null
  organizationName: string | null
  organizationSlug: string | null
  onboardingCompletedAt: Date | null
}

export async function getOnboardingSnapshot(userId: string): Promise<OnboardingSnapshot> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: {
      onboardingStatus: true,
      onboardingStep: true,
      organizationId: true,
    },
  })
  if (!u) {
    return {
      userStatus: 'PENDING',
      userStep: 'ACCOUNT_CREATED',
      organizationStatus: 'PENDING',
      organizationId: null,
      organizationName: null,
      organizationSlug: null,
      onboardingCompletedAt: null,
    }
  }
  const o = await db.organization.findUnique({
    where: { id: u.organizationId },
    select: {
      onboardingStatus: true,
      onboardingCompletedAt: true,
      name: true,
      slug: true,
    },
  })
  return {
    userStatus: u.onboardingStatus,
    userStep: u.onboardingStep,
    organizationStatus: o?.onboardingStatus ?? 'PENDING',
    organizationId: u.organizationId,
    organizationName: o?.name ?? null,
    organizationSlug: o?.slug ?? null,
    onboardingCompletedAt: o?.onboardingCompletedAt ?? null,
  }
}

export function isFullyOnboarded(s: OnboardingSnapshot): boolean {
  return s.userStatus === 'COMPLETED' && s.organizationStatus === 'COMPLETED'
}

/**
 * Pick the next onboarding route for a user that is not yet
 * COMPLETED. The first ADMIN always has step ORG_PENDING (because we
 * create the User with PENDING and no organization on signup).
 */
export function nextOnboardingRoute(s: OnboardingSnapshot): string {
  if (s.userStep === 'ACCOUNT_CREATED' || s.userStep === 'ORG_PENDING') {
    return '/onboarding/workspace'
  }
  if (s.userStep === 'ORG_CREATED') {
    return '/onboarding/company'
  }
  if (s.userStep === 'COMPANY_CONFIGURED') {
    return '/onboarding/team'
  }
  if (s.userStep === 'TEAM_INVITED') {
    return '/onboarding/done'
  }
  return '/dashboard'
}
