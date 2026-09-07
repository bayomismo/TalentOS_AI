'use client'

/**
 * Sprint 16 — Reset password page.
 *
 * Reads the plaintext token from the URL hash fragment (set by the
 * reset link in the email). The fragment is never sent to the server
 * in a referer or in normal navigation logs, so the token only
 * lives in the user's browser. Submits the token + new password to
 * `confirmPasswordResetAction`.
 */

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  Loader2Icon,
  LockIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { confirmPasswordResetAction } from '@/app/(auth)/actions'

function getTokenFromHash(): string | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return null
  const params = new URLSearchParams(hash)
  return params.get('token')
}

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    setToken(getTokenFromHash())
  }, [])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!token) {
      setError('Missing reset token. Use the link from your email, or request a new reset.')
      return
    }
    if (password.length < 10) {
      setError('Password must be at least 10 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    startTransition(async () => {
      const r = await confirmPasswordResetAction({ token, password })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      setSuccess(true)
    })
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 mb-4">
              <CheckCircle2Icon className="h-6 w-6 text-emerald-500" aria-hidden />
            </div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
              Password updated
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              You can now sign in with your new password.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-500 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            >
              Continue to sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (token === null) {
    // Still resolving the hash on first render — show a skeleton
    return null
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-950/40">
              <AlertCircleIcon className="h-5 w-5 text-rose-600" aria-hidden />
            </div>
            <div className="flex-1">
              <h1 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Invalid reset link
              </h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                The link you used is missing a reset token. Use the link from your email
                exactly as sent, or request a new reset.
              </p>
              <Link
                href="/forgot-password"
                className="mt-4 inline-flex items-center gap-1.5 text-sm text-emerald-600 hover:underline"
              >
                Request a new reset link
              </Link>
            </div>
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
        <div className="mt-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
            <LockIcon className="h-5 w-5 text-emerald-600" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Choose a new password
          </h1>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Pick a strong password (10+ characters) you don't use anywhere else.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              New password
            </span>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              autoFocus
              disabled={pending}
              minLength={10}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Confirm new password
            </span>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              disabled={pending}
              minLength={10}
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
            {pending ? 'Updating password…' : 'Update password'}
          </Button>
        </form>
      </div>
    </div>
  )
}
