'use client'

/**
 * Sprint 13 — Public signup form.
 *
 * The form is fully client-side. On submit it calls
 * publicSignupAction, then autoSignInAfterSignup, then redirects to
 * /onboarding/workspace.
 *
 * No real password is ever sent in a URL or logged. We track the
 * typed password in component state only.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AlertCircleIcon, CheckIcon, Loader2Icon } from 'lucide-react'
import { publicSignupAction, autoSignInAfterSignup } from '@/lib/onboarding/actions'

export function SignupForm() {
  const router = useRouter()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      setError('All fields are required.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 10) {
      setError('Password must be at least 10 characters.')
      return
    }
    startTransition(async () => {
      const r = await publicSignupAction({ email, password, firstName, lastName })
      if (!r.ok) { setError(r.error?.message ?? 'Sign up failed.'); return }
      // Auto-sign-in
      const s = await autoSignInAfterSignup({ email, password })
      if (!s.ok) {
        // Fall back to login page
        router.replace('/login?signed_up=1')
        return
      }
      // Force a hard refresh so the new session is picked up by the
      // server-rendered onboarding page.
      window.location.href = '/onboarding/workspace'
    })
  }

  const passwordsMatch = password && confirmPassword && password === confirmPassword
  const longEnough = password.length >= 10
  const hasLetter = /[a-zA-Z]/.test(password)
  const hasNumber = /[0-9]/.test(password)

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
    >
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          <AlertCircleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            First name
          </label>
          <input
            id="firstName"
            type="text"
            required
            autoComplete="given-name"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
          />
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Last name
          </label>
          <input
            id="lastName"
            type="text"
            required
            autoComplete="family-name"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            className="mt-1 h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
          />
        </div>
      </div>

      <label htmlFor="email" className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">
        Work email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
        placeholder="you@yourcompany.com"
      />

      <label htmlFor="password" className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">
        Password
      </label>
      <input
        id="password"
        type="password"
        required
        autoComplete="new-password"
        minLength={10}
        value={password}
        onChange={e => setPassword(e.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
      />
      <ul className="mt-1 space-y-0.5 text-xs">
        <PasswordCheck ok={longEnough} label="At least 10 characters" />
        <PasswordCheck ok={hasLetter} label="Contains a letter" />
        <PasswordCheck ok={hasNumber} label="Contains a digit" />
      </ul>

      <label htmlFor="confirm" className="mt-3 block text-sm font-medium text-slate-700 dark:text-slate-300">
        Confirm password
      </label>
      <input
        id="confirm"
        type="password"
        required
        autoComplete="new-password"
        minLength={10}
        value={confirmPassword}
        onChange={e => setConfirmPassword(e.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
      />
      {confirmPassword && !passwordsMatch && (
        <p className="mt-1 text-xs text-red-600">Passwords do not match.</p>
      )}

      <Button
        type="submit"
        disabled={pending || !longEnough || !hasLetter || !hasNumber || !passwordsMatch}
        className="mt-5 w-full"
      >
        {pending ? <><Loader2Icon className="h-4 w-4 animate-spin" /> Creating account…</> : 'Create account'}
      </Button>
      <p className="mt-3 text-center text-[10px] text-slate-500">
        By signing up you agree to our terms of service and privacy policy.
      </p>
    </form>
  )
}

function PasswordCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={cn(ok ? 'text-emerald-600' : 'text-slate-500')}>
      <span className="inline-flex items-center gap-1">
        {ok ? <CheckIcon className="h-3 w-3" /> : '○'} {label}
      </span>
    </li>
  )
}

function cn(...args: (string | false | null | undefined)[]): string {
  return args.filter(Boolean).join(' ')
}
