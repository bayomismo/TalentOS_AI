/**
 * Sprint 13 — Onboarding layout.
 *
 * Used by all /onboarding/* pages. Renders a top progress bar
 * showing the current step. Each step page is a server component
 * that loads the user's onboarding state and either advances or
 * redirects.
 */
import { auth } from '@/lib/auth/auth'
import { redirect } from 'next/navigation'
import { getOnboardingSnapshot, isFullyOnboarded } from '@/lib/onboarding/state'
import { OnboardingShell } from './_components/onboarding-shell'

export const metadata = {
  title: 'Onboarding · TalentOS AI',
}

const STEPS: Array<{ id: 'workspace' | 'company' | 'team' | 'done'; label: string }> = [
  { id: 'workspace', label: 'Create workspace' },
  { id: 'company', label: 'Company setup' },
  { id: 'team', label: 'Invite team' },
  { id: 'done', label: 'Finish' },
]

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }
  const snap = await getOnboardingSnapshot(session.user.id)
  if (isFullyOnboarded(snap)) {
    redirect('/dashboard')
  }
  const currentStep = stepFor(snap.userStep)
  return (
    <OnboardingShell currentStep={currentStep} steps={STEPS}>
      {children}
    </OnboardingShell>
  )
}

function stepFor(s: string): 'workspace' | 'company' | 'team' | 'done' {
  if (s === 'ACCOUNT_CREATED' || s === 'ORG_PENDING') return 'workspace'
  if (s === 'ORG_CREATED') return 'company'
  if (s === 'COMPANY_CONFIGURED') return 'team'
  return 'done'
}
