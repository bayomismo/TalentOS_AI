/**
 * Sprint 13 — Onboarding state transitions.
 *
 * Each onboarding step calls a function here to advance the state
 * machine. The state machine ensures we never skip steps and never
 * regress.
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

export async function completeOnboarding(ctx: {
  userId: string
  organizationId: string
}): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
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
