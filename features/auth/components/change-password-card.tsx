'use client'

/**
 * Sprint 9.1 — Change Password card for Settings → Security.
 *
 * The submit button is disabled while the request is in flight, the
 * form is cleared after success, and the user is signed out so the
 * active JWT is invalidated (the Auth.js cookie is removed). The
 * user is then redirected to /login.
 *
 * UI security:
 *  - No password is ever written to localStorage / sessionStorage.
 *  - `autocomplete` attributes are set per the spec.
 *  - `autoComplete="off"` is NOT used — the browser's built-in
 *    password manager support is intentional and welcome.
 *  - Show / hide toggles do not log the value.
 *  - On success we wipe the form fields before the redirect.
 */

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { CheckIcon, EyeIcon, EyeOffIcon, LoaderIcon, LockIcon, ShieldAlertIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { changePasswordAction } from '@/features/auth/actions/change-password'

interface FieldProps {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  ariaDescribedBy?: string
  hint?: string
  error?: string | null
  showToggle: boolean
  isShown: boolean
  onToggleShown: () => void
  disabled?: boolean
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  ariaDescribedBy,
  hint,
  error,
  showToggle,
  isShown,
  onToggleShown,
  disabled,
}: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={isShown ? 'text' : 'password'}
          autoComplete={autoComplete}
          spellCheck={false}
          required
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          value={value}
          onChange={e => onChange(e.target.value)}
          className={cn(
            'h-10 w-full rounded-lg border bg-white px-3 pr-10 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2',
            'dark:bg-slate-800 dark:text-slate-50',
            error
              ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20 dark:border-red-700'
              : 'border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/20 dark:border-slate-700',
          )}
        />
        {showToggle && (
          <button
            type="button"
            onClick={onToggleShown}
            tabIndex={-1}
            aria-label={isShown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            {isShown ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
          </button>
        )}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

export function ChangePasswordCard() {
  const router = useRouter()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ current?: string; next?: string; confirm?: string }>({})
  const [success, setSuccess] = useState(false)
  const [pending, startTransition] = useTransition()

  // The form element is held so we can wipe it on success.
  const formRef = useRef<HTMLFormElement | null>(null)

  function clearForm() {
    setCurrent('')
    setNext('')
    setConfirm('')
    setError(null)
    setFieldErrors({})
    formRef.current?.reset()
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    setError(null)
    setFieldErrors({})
    startTransition(async () => {
      const result = await changePasswordAction({
        currentPassword: current,
        newPassword: next,
        confirmPassword: confirm,
      })
      if (result.ok) {
        setSuccess(true)
        // Wipe the form so values are not retained after navigation.
        clearForm()
        // Sign out the current session. The Auth.js cookie is removed.
        // The `passwordChangedAt` bump + the `AuthSession` revocation
        // already invalidated the server-side trust, but we still want
        // the UI to land on /login.
        await signOut({ redirect: false })
        router.push('/login?reason=password-changed')
        router.refresh()
        return
      }
      const code = result.error.code
      const message = result.error.message
      setError(message)
      if (code === 'INCORRECT_CURRENT_PASSWORD') {
        setFieldErrors({ current: 'Current password is incorrect.' })
      } else if (code === 'WEAK_NEW_PASSWORD') {
        setFieldErrors({ next: 'Your new password does not meet the password requirements.' })
      } else if (code === 'CONFIRMATION_MISMATCH') {
        setFieldErrors({ confirm: 'New password and confirmation do not match.' })
      } else if (code === 'SAME_PASSWORD') {
        setFieldErrors({ next: 'Your new password must be different from your current password.' })
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockIcon className="h-4 w-4 text-emerald-600" />
          Change password
        </CardTitle>
        <CardDescription>
          Update the password you use to sign in. You will be signed out and asked to sign in again with your new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {success ? (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <CheckIcon className="mt-0.5 h-5 w-5 flex-none text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                Your password has been changed.
              </p>
              <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200/80">
                For your security, please sign in again. Redirecting…
              </p>
            </div>
          </div>
        ) : (
          <form
            ref={formRef}
            onSubmit={onSubmit}
            noValidate
            className="space-y-5"
            data-testid="change-password-form"
          >
            <PasswordField
              id="current-password"
              label="Current password"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              showToggle
              isShown={showCurrent}
              onToggleShown={() => setShowCurrent(v => !v)}
              disabled={pending}
              error={fieldErrors.current}
              ariaDescribedBy="current-password-hint"
              hint="The password you use to sign in today."
            />
            <PasswordField
              id="new-password"
              label="New password"
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              showToggle
              isShown={showNext}
              onToggleShown={() => setShowNext(v => !v)}
              disabled={pending}
              error={fieldErrors.next}
              ariaDescribedBy="new-password-hint"
              hint="At least 10 characters, with letters and digits."
            />
            <PasswordField
              id="confirm-password"
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              showToggle
              isShown={showConfirm}
              onToggleShown={() => setShowConfirm(v => !v)}
              disabled={pending}
              error={fieldErrors.confirm}
              ariaDescribedBy="confirm-password-hint"
              hint="Re-enter the new password to confirm."
            />

            {error && !fieldErrors.current && !fieldErrors.next && !fieldErrors.confirm && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
              >
                <ShieldAlertIcon className="mt-0.5 h-4 w-4 flex-none" />
                <p>{error}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearForm}
                disabled={pending}
              >
                Clear
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={pending || !current || !next || !confirm}
                data-testid="change-password-submit"
              >
                {pending && <LoaderIcon className="mr-2 h-3.5 w-3.5 animate-spin" />}
                {pending ? 'Changing…' : 'Change password'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
