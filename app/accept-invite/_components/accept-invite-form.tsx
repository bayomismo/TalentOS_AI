'use client'

/**
 * Sprint 9 — Accept Invitation form (client).
 *
 * The token is in `location.hash` (URL fragment). It is read here in
 * the browser and sent to the server action. The server validates the
 * token, creates/activates the user, and marks the invitation ACCEPTED.
 */
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AlertCircleIcon, Loader2Icon } from 'lucide-react'
import { acceptInvitationAction } from './_actions'

export function AcceptInviteForm() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    const hash = window.location.hash
    const match = hash.match(/token=([^&]+)/)
    setToken(match ? decodeURIComponent(match[1]) : null)
  }, [])

  if (token === null) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        <AlertCircleIcon className="inline h-4 w-4 mr-2" />
        No invitation token found. Please use the link from your invitation email.
      </div>
    )
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 10) {
      setError('Password must be at least 10 characters.')
      return
    }
    startTransition(async () => {
      const r = await acceptInvitationAction({ token, firstName, lastName, password })
      if (r.ok) {
        // Redirect to /login with a success indicator
        router.replace('/login?accepted=1')
      } else {
        setError(r.error.message)
      }
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
    >
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
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
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            className="mt-1 h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
          />
        </div>
      </div>

      <label htmlFor="password" className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">
        Choose a password
      </label>
      <input
        id="password"
        type="password"
        required
        minLength={10}
        value={password}
        onChange={e => setPassword(e.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
      />
      <p className="mt-1 text-xs text-slate-500">At least 10 characters, with letters and numbers.</p>

      <label htmlFor="confirm" className="mt-3 block text-sm font-medium text-slate-700 dark:text-slate-300">
        Confirm password
      </label>
      <input
        id="confirm"
        type="password"
        required
        minLength={10}
        value={confirmPassword}
        onChange={e => setConfirmPassword(e.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
      />

      <Button type="submit" size="lg" className="mt-6 w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
            Accepting…
          </>
        ) : (
          'Accept invitation'
        )}
      </Button>
    </form>
  )
}
