/**
 * Sprint 13 — Onboarding: Create workspace (organization).
 *
 * This is the first step for a brand-new user. The user is the
 * first ADMIN of the workspace they create here.
 */
import { auth } from '@/lib/auth/auth'
import { redirect } from 'next/navigation'
import { getOnboardingSnapshot } from '@/lib/onboarding/state'
import { WorkspaceForm } from '../_components/workspace-form'

export const dynamic = 'force-dynamic'

export default async function WorkspacePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const snap = await getOnboardingSnapshot(session.user.id)
  // If the user is past the workspace step, push them forward.
  if (snap.userStep === 'ORG_CREATED' || snap.userStep === 'COMPANY_CONFIGURED' || snap.userStep === 'TEAM_INVITED') {
    redirect('/onboarding/company')
  }
  if (snap.userStep === 'COMPLETED') redirect('/dashboard')

  return (
    <>
      <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Create your workspace</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Your workspace is the home for your team. You will be its first administrator.
      </p>
      <WorkspaceForm
        defaultName={session.user.firstName && session.user.lastName ? `${session.user.firstName} ${session.user.lastName}'s workspace` : ''}
      />
    </>
  )
}
