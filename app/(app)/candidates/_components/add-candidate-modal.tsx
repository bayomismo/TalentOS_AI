'use client'

/**
 * Add Candidate modal.
 *
 * Sprint 15 P1 fix — replaces the previously dead "Add candidate" button.
 * Collects the minimum required fields (first/last name, email, hiring
 * request, optional source + location) and submits via
 * `createCandidateAction`. On success, refreshes the candidate list and
 * closes the modal. On error, displays the error message inline.
 */

import { useEffect, useState, useTransition } from 'react'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  UserPlusIcon,
  XIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  createCandidateAction,
  getHiringRequestsForSelectAction,
  type CreateCandidateResult,
  type HiringRequestOption,
} from '../actions'

interface AddCandidateModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

const SOURCE_OPTIONS = [
  { value: '', label: 'Select a source…' },
  { value: 'Referral', label: 'Referral' },
  { value: 'LinkedIn', label: 'LinkedIn' },
  { value: 'Company Site', label: 'Company Site' },
  { value: 'Indeed', label: 'Indeed' },
  { value: 'AngelList', label: 'AngelList' },
  { value: 'Other', label: 'Other' },
]

export function AddCandidateModal({ open, onClose, onCreated }: AddCandidateModalProps) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [hiringRequestId, setHiringRequestId] = useState('')
  const [source, setSource] = useState('')
  const [location, setLocation] = useState('')
  const [requests, setRequests] = useState<HiringRequestOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  // Load hiring requests when modal opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setRequestsLoading(true)
    getHiringRequestsForSelectAction()
      .then(r => {
        if (cancelled) return
        setRequests(r.requests)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load hiring requests')
      })
      .finally(() => {
        if (cancelled) return
        setRequestsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Reset form when closed.
  useEffect(() => {
    if (open) return
    setFirstName('')
    setLastName('')
    setEmail('')
    setHiringRequestId('')
    setSource('')
    setLocation('')
    setError(null)
    setSuccess(false)
  }, [open])

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, pending, onClose])

  if (!open) return null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required.')
      return
    }
    if (!email.trim()) {
      setError('Email is required.')
      return
    }
    if (!hiringRequestId) {
      setError('Please choose a hiring request.')
      return
    }
    startTransition(async () => {
      const result: CreateCandidateResult = await createCandidateAction({
        firstName,
        lastName,
        email,
        hiringRequestId,
        source: source || null,
        location: location || null,
      })
      if (!result.ok) {
        setError(result.error ?? 'Failed to add candidate.')
        return
      }
      setSuccess(true)
      onCreated()
      // Give the user a moment to see the success state before closing.
      setTimeout(() => {
        onClose()
      }, 800)
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-candidate-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => {
        if (e.target === e.currentTarget && !pending) onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <UserPlusIcon className="h-5 w-5 text-emerald-600" aria-hidden />
            <h2
              id="add-candidate-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-50"
            >
              Add candidate
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close add candidate dialog"
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-50 dark:hover:bg-slate-700"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-6">
          {success ? (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200"
            >
              <CheckCircle2Icon className="h-5 w-5" aria-hidden />
              <div>
                <p className="font-medium">Candidate added</p>
                <p className="text-xs">Refreshing the list…</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" required>
                  <input
                    type="text"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    required
                    autoComplete="given-name"
                    disabled={pending}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                  />
                </Field>
                <Field label="Last name" required>
                  <input
                    type="text"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    required
                    autoComplete="family-name"
                    disabled={pending}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                  />
                </Field>
              </div>

              <Field label="Email" required>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  disabled={pending}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                />
              </Field>

              <Field label="Hiring request" required>
                {requestsLoading ? (
                  <div className="flex h-9 items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Loading hiring requests…
                  </div>
                ) : requests.length === 0 ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                    No open hiring requests yet. Create one from Hiring Requests first.
                  </p>
                ) : (
                  <select
                    value={hiringRequestId}
                    onChange={e => setHiringRequestId(e.target.value)}
                    required
                    disabled={pending}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                  >
                    <option value="">Select a hiring request…</option>
                    {requests.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Source">
                  <select
                    value={source}
                    onChange={e => setSource(e.target.value)}
                    disabled={pending}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                  >
                    {SOURCE_OPTIONS.map(s => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Location">
                  <input
                    type="text"
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    placeholder="e.g. New York, NY"
                    autoComplete="address-level2"
                    disabled={pending}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                  />
                </Field>
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300"
                >
                  <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </form>

        {!success && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-700 dark:bg-slate-900/50">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <button
              type="submit"
              form=""
              onClick={submit}
              disabled={pending || requests.length === 0}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-500 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending && <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Add candidate
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
    </label>
  )
}
