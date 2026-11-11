/**
 * Sprint 13 / Sprint 19 — Onboarding state transitions.
 *
 * Each onboarding step calls a function here to advance the state
 * machine. The state machine ensures we never skip steps and never
 * regress.
 *
 * Sprint 19 (business-flow audit P0-08 / P1-21):
 *
 *   · `completeOnboarding` used to complete the flow for ANY
 *     authenticated user, whatever step they were on. A brand-new signup
 *     who navigated straight to /onboarding/done was dropped into the
 *     throwaway placeholder organization, told onboarding was complete,
 *     and from then on every attempt to create a real workspace failed
 *     with "You already belong to an organization". Completion now
 *     REQUIRES the last real step, and the organization must actually
 *     have a company configuration — an organization with no country, no
 *     timezone and no industry schedules its interview reminders in the
 *     wrong timezone.
 *
 *   · Every failure is a RETURNED result, never a thrown error, and no
 *     caller discards it any more.
 */

import 'server-only'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'
import type { OnboardingStep } from '@prisma/client'

const ALLOWED_NEXT: Record<OnboardingStep, OnboardingStep | null> = {
  ACCOUNT_CREATED: 'ORG_PENDING',
  ORG_PENDING: 'ORG_CREATED',
  ORG_CREATED: 'COMPANY_CONFIGURED',
  COMPANY_CONFIGURED: 'TEAM_INVITED',
  TEAM_INVITED: 'COMPLETED',
  COMPLETED: null,
}

/**
 * The company fields an organization must have before it can be called
 * fully onboarded. `size` is deliberately NOT one of them — it is nice to
 * have, not operationally required.
 */
export const REQUIRED_COMPANY_FIELDS = ['country', 'timezone', 'industry'] as const

export interface CompanyConfiguration {
  country: string | null
  timezone: string | null
  industry: string | null
}

/** The company fields that are still missing. Empty when configured. */
export function missingCompanyFields(org: CompanyConfiguration): string[] {
  return REQUIRED_COMPANY_FIELDS.filter((field) => {
    const value = org[field]
    return typeof value !== 'string' || value.trim().length === 0
  })
}

export async function transitionOnboardingStep(
  ctx: { userId: string; organizationId: string },
  next: OnboardingStep,
): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
  const u = await db.user.findFirst({
    where: { id: ctx.userId, organizationId: ctx.organizationId },
    select: { id: true, onboardingStep: true, onboardingStatus: true },
  })
  if (!u) return { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } }
  const expected = ALLOWED_NEXT[u.onboardingStep]
  if (expected !== next) {
    // allow same-step re-entry (idempotent)
    if (u.onboardingStep === next) return { ok: true }
    return {
      ok: false,
      error: {
        code: 'INVALID_TRANSITION',
        message: `Cannot move from ${u.onboardingStep} to ${next}.`,
      },
    }
  }
  await db.user.update({ where: { id: ctx.userId }, data: { onboardingStep: next } })
  return { ok: true }
}

/** The context `completeOnboarding` and `canCompleteOnboarding` need. */
export interface OnboardingCompletionContext {
  userId: string
  organizationId: string
}

/** The result shape both completion helpers return. */
export interface OnboardingCompletionResult {
  ok: boolean
  error?: { code: string; message: string }
}

/**
 * True when this user may finish onboarding.
 *
 * Two independent conditions, both required (audit P0-08 / P1-21):
 *   1. the user is on the last real step (TEAM_INVITED), or already
 *      finished — a direct visit to /onboarding/done from an earlier
 *      step must NOT complete the flow;
 *   2. the organization has a company configuration.
 */
export async function canCompleteOnboarding(
  ctx: OnboardingCompletionContext,
): Promise<OnboardingCompletionResult & { missing?: string[] }> {
  const user = await db.user.findFirst({
    where: { id: ctx.userId, organizationId: ctx.organizationId },
    select: { id: true, onboardingStep: true, onboardingStatus: true },
  })
  if (!user) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } }
  }

  if (user.onboardingStep !== 'TEAM_INVITED' && user.onboardingStep !== 'COMPLETED') {
    return {
      ok: false,
      error: {
        code: 'INVALID_TRANSITION',
        message: `Onboarding cannot be completed from step ${user.onboardingStep}.`,
      },
    }
  }

  const org = await db.organization.findFirst({
    where: { id: ctx.organizationId },
    select: { id: true, country: true, timezone: true, industry: true },
  })
  if (!org) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Organization not found.' } }
  }

  const missing = missingCompanyFields(org)
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: 'INCOMPLETE_COMPANY_SETUP',
        message: `Set ${missing.join(', ')} before finishing onboarding.`,
      },
      missing,
    }
  }

  return { ok: true }
}

export async function completeOnboarding(
  ctx: OnboardingCompletionContext,
): Promise<OnboardingCompletionResult> {
  // The gate. Without it, ANY authenticated user could complete
  // onboarding — including against the throwaway placeholder org.
  // `canCompleteOnboarding` checks the onboardingStep (the last real
  // step) AND the organization's company configuration.
  const allowed = await canCompleteOnboarding(ctx)
  if (!allowed.ok) return { ok: false, error: allowed.error }

  const now = new Date()
  await db.$transaction([
    db.user.update({
      where: { id: ctx.userId },
      data: { onboardingStatus: 'COMPLETED', onboardingStep: 'COMPLETED' },
    }),
    db.organization.update({
      where: { id: ctx.organizationId },
      data: { onboardingStatus: 'COMPLETED', onboardingCompletedAt: now },
    }),
  ])
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'ONBOARDING_COMPLETED' as never,
    targetType: 'user',
    targetId: ctx.userId,
    outcome: 'success',
    metadata: {} as any,
  }).catch(() => null)
  return { ok: true }
}
