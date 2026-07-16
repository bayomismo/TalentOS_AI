/**
 * Sprint 13 — Onboarding: Done.
 *
 * This page is reached only if the user navigates directly here
 * after inviting team. It immediately transitions to COMPLETED and
 * redirects to /dashboard.
 */
import { auth } from '@/lib/auth/auth'
import { redirect } from 'next/navigation'
import { getOnboardingSnapshot, isFullyOnboarded } from '@/lib/onboarding/state'
import { completeOnboardingAction } from '@/lib/onboarding/actions'
import { completeOnboarding } from '@/lib/onboarding/transitions'

export const dynamic = 'force-dynamic'

export default async function DonePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const snap = await getOnboardingSnapshot(session.user.id)
  if (!isFullyOnboarded(snap)) {
    // Mark complete
    if (snap.organizationId) {
      await completeOnboarding({ userId: session.user.id, organizationId: snap.organizationId }).catch(() => null)
    }
  }
  redirect('/dashboard')
}
