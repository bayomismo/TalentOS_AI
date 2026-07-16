/**
 * Sprint 13 — Onboarding: Invite team.
 */
import { auth } from '@/lib/auth/auth'
import { redirect } from 'next/navigation'
import { getOnboardingSnapshot } from '@/lib/onboarding/state'
import { InviteTeamForm } from '../_components/invite-team-form'

export const dynamic = 'force-dynamic'

export default async function TeamPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const snap = await getOnboardingSnapshot(session.user.id)
  if (snap.userStep === 'ACCOUNT_CREATED' || snap.userStep === 'ORG_PENDING') {
    redirect('/onboarding/workspace')
  }
  if (snap.userStep === 'ORG_CREATED') {
    redirect('/onboarding/company')
  }
  if (snap.userStep === 'TEAM_INVITED') {
    redirect('/onboarding/done')
  }
  if (snap.userStep === 'COMPLETED') redirect('/dashboard')

  return (
    <>
      <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Invite your team</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        TalentOS works best with your team. Add the people who will help you hire. You can also do this later from Settings → Team & Users.
      </p>
      <InviteTeamForm />
    </>
  )
}
