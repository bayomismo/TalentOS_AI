/**
 * Sprint 13 — Onboarding index. Redirects to the user's current step.
 */
import { auth } from '@/lib/auth/auth'
import { redirect } from 'next/navigation'
import { getOnboardingSnapshot, isFullyOnboarded, nextOnboardingRoute } from '@/lib/onboarding/state'

export const dynamic = 'force-dynamic'

export default async function OnboardingIndex() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const snap = await getOnboardingSnapshot(session.user.id)
  if (isFullyOnboarded(snap)) redirect('/dashboard')
  redirect(nextOnboardingRoute(snap))
}
