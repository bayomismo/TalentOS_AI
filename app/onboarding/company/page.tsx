/**
 * Sprint 13 — Onboarding: Company setup.
 */
import { auth } from '@/lib/auth/auth'
import { redirect } from 'next/navigation'
import { getOnboardingSnapshot } from '@/lib/onboarding/state'
import { getOwnOrganization } from '@/lib/organization/service'
import { CompanySetupForm } from '../_components/company-setup-form'

export const dynamic = 'force-dynamic'

export default async function CompanyPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const snap = await getOnboardingSnapshot(session.user.id)
  if (snap.userStep === 'ACCOUNT_CREATED' || snap.userStep === 'ORG_PENDING') {
    redirect('/onboarding/workspace')
  }
  if (snap.userStep === 'COMPANY_CONFIGURED' || snap.userStep === 'TEAM_INVITED') {
    redirect('/onboarding/team')
  }
  if (snap.userStep === 'COMPLETED') redirect('/dashboard')

  const org = await getOwnOrganization({ organizationId: snap.organizationId! })
  if (!org) redirect('/onboarding/workspace')

  return (
    <>
      <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Company setup</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Tell us a bit about <span className="font-medium text-slate-700 dark:text-slate-200">{org.name}</span>. You can change these any time.
      </p>
      <CompanySetupForm
        defaults={{
          industry: org.industry ?? '',
          size: org.size ?? '',
          country: org.country ?? '',
          timezone: org.timezone ?? '',
        }}
      />
    </>
  )
}
