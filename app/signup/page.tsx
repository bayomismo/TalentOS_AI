/**
 * Sprint 13 — Public Signup page.
 *
 * Accessible without authentication. Creates a personal account
 * (User with placeholder organization and onboardingStatus=PENDING).
 * The user is then auto-signed-in and redirected to
 * /onboarding/workspace to create their organization.
 *
 * Marketing site URLs: NO existing organization, NO existing user
 * required.
 */
import { Suspense } from 'react'
import { Sparkles } from 'lucide-react'
import { SignupForm } from './_components/signup-form'
import { auth } from '@/lib/auth/auth'
import { redirect } from 'next/navigation'
import { getOnboardingSnapshot } from '@/lib/onboarding/state'

export const metadata = {
  title: 'Sign up · TalentOS AI',
  description: 'Create your TalentOS workspace in 60 seconds. No credit card required.',
}

export default async function SignupPage() {
  // If already signed in, redirect to onboarding or dashboard
  const session = await auth()
  if (session?.user?.id) {
    const snap = await getOnboardingSnapshot(session.user.id)
    if (snap.userStatus === 'COMPLETED' && snap.organizationStatus === 'COMPLETED') {
      redirect('/dashboard')
    }
    if (!snap.organizationId || snap.organizationStatus === 'PENDING') {
      redirect('/onboarding/workspace')
    }
    redirect('/onboarding/company')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 mb-4">
            <Sparkles className="h-6 w-6 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Create your TalentOS workspace
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Start a 14-day trial. No credit card required. Set up your team in under 60 seconds.
          </p>
        </div>
        <Suspense fallback={<div className="h-96 animate-pulse rounded-lg border border-slate-200 bg-white" />}>
          <SignupForm />
        </Suspense>
        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
          Already have an account?{' '}
          <a href="/login" className="font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">
            Sign in
          </a>
        </p>
      </div>
    </div>
  )
}
