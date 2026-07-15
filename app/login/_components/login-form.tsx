'use client'

/**
 * Sprint 9 — Login form.
 *
 * Credentials sign-in via Auth.js. The server action calls `signIn` from
 * `next-auth/react` (or the form action POSTs to /api/auth/callback/credentials).
 * We use the form action so the Auth.js JWT cookie is set by the server
 * response and the browser navigates with cookies intact.
 */

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { AlertCircleIcon, Loader2Icon, LockIcon, MailIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LoginForm() {
  const router = useRouter()
  const search = useSearchParams()
  const callbackUrl = search.get('callbackUrl') ?? '/dashboard'
  const expired = search.get('expired') === '1'
  const reason = search.get('reason') // 'disabled' | 'password_changed' | null

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(
    expired
      ? 'Your session has expired. Please sign in again.'
      : reason === 'disabled'
        ? 'Your account has been disabled. Contact an administrator.'
        : reason === 'password_changed'
          ? 'Your password was changed. Please sign in again.'
          : null,
  )
  const [loading, setLoading] = useState(false)
  const [isPending, startTransition] = useTransition()

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setError(null)
    setLoading(true)
    const result = await signIn('credentials', {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    })
    setLoading(false)
    if (!result || result.error) {
      setError('Invalid email or password.')
      return
    }
    // Use a hard navigation so the server-side session is re-read.
    startTransition(() => {
      window.location.href = callbackUrl
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
    >
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <AlertCircleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        Email
      </label>
      <div className="mt-1 relative">
        <MailIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          className={cn(
            'h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm',
            'focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20',
            'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50',
          )}
          placeholder="you@company.com"
        />
      </div>

      <label htmlFor="password" className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">
        Password
      </label>
      <div className="mt-1 relative">
        <LockIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          className={cn(
            'h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm',
            'focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20',
            'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50',
          )}
        />
      </div>

      <Button
        type="submit"
        size="lg"
        className="mt-6 w-full"
        disabled={loading || isPending}
      >
        {loading || isPending ? (
          <>
            <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            Signing in…
          </>
        ) : (
          'Sign In'
        )}
      </Button>
    </form>
  )
}
