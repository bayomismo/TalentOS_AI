/**
 * Sprint 13 — App layout with onboarding guard.
 *
 * The (app) layout is a server component that checks the user's
 * onboarding state from the DB on every navigation. If onboarding is
 * incomplete, the user is redirected to the appropriate step.
 *
 * The actual layout shell (sidebar, header, etc.) lives in the
 * client component below.
 */
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/auth'
import { getOnboardingSnapshot, isFullyOnboarded, nextOnboardingRoute } from '@/lib/onboarding/state'
import { AppLayoutClient } from './layout-client'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) {
    // Middleware should have caught this, but defense in depth.
    redirect('/login')
  }
  // Onboarding guard. We re-read the DB on every request so that a
  // state transition in a server action is reflected immediately.
  const snap = await getOnboardingSnapshot(session.user.id)
  if (!isFullyOnboarded(snap)) {
    redirect(nextOnboardingRoute(snap))
  }
  return <AppLayoutClient>{children}</AppLayoutClient>
}
