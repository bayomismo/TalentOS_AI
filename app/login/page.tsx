/**
 * Sprint 9 — Login page.
 *
 * PART 3: email + password sign-in. Loading state, invalid credentials
 * state, session expired state, account disabled state. We do not reveal
 * whether a specific email exists.
 */
import { Suspense } from 'react'
import { LoginForm } from './_components/login-form'
import { Sparkles } from 'lucide-react'

export const metadata = {
  title: 'Sign in · TalentOS AI',
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 mb-4">
            <Sparkles className="h-6 w-6 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            TalentOS AI
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Sign in to your recruiting workspace
          </p>
        </div>

        <Suspense fallback={<div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-white" />}>
          <LoginForm />
        </Suspense>

        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-500">
          By signing in you agree to keep candidate data confidential and within
          your organization.
        </p>
      </div>
    </div>
  )
}
