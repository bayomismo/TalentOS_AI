/**
 * Sprint 13 / Sprint 19 — Onboarding: Done.
 *
 * This page is reached only after the team step. It transitions to
 * COMPLETED and redirects to /dashboard.
 *
 * Sprint 19 (audit P0-08): the page used to complete onboarding for ANY
 * authenticated user, whatever step they were on, against whatever
 * organization they happened to be in. A brand-new signup who navigated
 * straight here was dropped into the throwaway placeholder organization,
 * told onboarding was complete, and from then on every attempt to create
 * a real workspace failed with "You already belong to an organization" —
 * the tenant signup was dead on arrival.
 *
 * The page now completes onboarding ONLY when the user is on the last
 * real step and the organization has a company configuration. Otherwise
 * it sends the user back to the step they still owe, which is the same
 * place the onboarding state machine says they belong.
 */
import { auth } from '@/lib/auth/auth'
import { redirect } from 'next/navigation'
import { getOnboardingSnapshot, isFullyOnboarded, nextOnboardingRoute } from '@/lib/onboarding/state'
import { completeOnboarding } from '@/lib/onboarding/transitions'

export const dynamic = 'force-dynamic'

export default async function DonePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const snap = await getOnboardingSnapshot(session.user.id)
  if (!isFullyOnboarded(snap)) {
    if (!snap.organizationId) {
      // No organization at all — the workspace step still has to run.
      redirect('/onboarding/workspace')
    }
    const result = await completeOnboarding({
      userId: session.user.id,
      organizationId: snap.organizationId,
    })
    if (!result.ok) {
      // Not allowed to finish yet. Send the user to the step they still
      // owe. `nextOnboardingRoute` is derived from the STORED step, so
      // the redirect can never loop on this page — except at TEAM_INVITED,
      // where the refusal is about the missing company configuration.
      if (snap.userStep === 'TEAM_INVITED') {
        redirect('/onboarding/company')
      }
      redirect(nextOnboardingRoute(snap))
    }
  }
  redirect('/dashboard')
}
