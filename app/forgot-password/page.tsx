'use client'

/**
 * Sprint 16 — Forgot password page.
 *
 * Renders a single email input. On submit, calls
 * `requestPasswordResetAction` and always shows the same generic
 * "If an account exists for that email, we sent a reset link."
 * message — regardless of whether the email is registered. This is
 * intentional to prevent user-enumeration attacks.
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, CheckCircle2Icon, Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { requestPasswordResetAction } from '@/app/(auth)/actions'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError('Please enter your email.')
      return
    }
    startTransition(async () => {
      const r = await requestPasswordResetAction({
        email,
        requestIp: null,
        requestUserAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      setSubmitted(true)
    })
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 mb-4">
              <CheckCircle2Icon className="h-6 w-6 text-emerald-500" aria-hidden />
            </div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
              Check your email
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              If an account exists for <strong>{email}</strong>, we sent a password reset link.
              The link expires in 60 minutes.
            </p>
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              Didn't get the email? Check your spam folder, or{' '}
              <button
                type="button"
                onClick={() => setSubmitted(false)}
                className="text-emerald-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 rounded"
              >
                try again
              </button>
              .
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
            >
              <ArrowLeftIcon className="h-4 w-4" aria-hidden />
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden />
          Back to sign in
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Forgot your password?
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Enter your email and we'll send you a link to choose a new password.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
              disabled={pending}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <Button type="submit" disabled={pending} className="w-full">
            {pending && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden />}
            {pending ? 'Sending reset link…' : 'Send reset link'}
          </Button>
        </form>
      </div>
    </div>
  )
}
