'use client'

/**
 * New Template modal — Sprint 15 P1 fix.
 *
 * Replaces the previously dead "+ New template" button. Collects
 * title, level, category, summary, description, and optional skills,
 * then submits to `createJobTemplateAction`. On success, refreshes
 * the library and closes. On error, displays inline.
 *
 * Full a11y: role=dialog, aria-modal, body scroll lock, Escape to
 * close, click outside to close (same pattern as AddCandidateModal).
 */

import { useEffect, useState, useTransition } from 'react'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PlusIcon,
  XIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createJobTemplateAction, type CreateJobTemplateResult } from '../actions'

interface NewTemplateModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

const LEVEL_OPTIONS = [
  { value: 'JUNIOR', label: 'Junior' },
  { value: 'MID', label: 'Mid' },
  { value: 'SENIOR', label: 'Senior' },
  { value: 'STAFF', label: 'Staff' },
  { value: 'PRINCIPAL', label: 'Principal' },
  { value: 'LEAD', label: 'Lead' },
]

const CATEGORY_OPTIONS = [
  'Engineering',
  'Product',
  'Design',
  'Data',
  'Operations',
  'Sales',
  'Marketing',
  'Other',
]

export function NewTemplateModal({ open, onClose, onCreated }: NewTemplateModalProps) {
  const [title, setTitle] = useState('')
  const [level, setLevel] = useState('MID')
  const [category, setCategory] = useState('Engineering')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [requiredSkills, setRequiredSkills] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pending, startTransition] = useTransition()

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = original }
  }, [open])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pending, onClose])

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTitle('')
      setLevel('MID')
      setCategory('Engineering')
      setSummary('')
      setDescription('')
      setRequiredSkills('')
      setError(null)
      setSuccess(false)
    }
  }, [open])

  if (!open) return null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r: CreateJobTemplateResult = await createJobTemplateAction({
        title,
        level,
        category,
        summary,
        description,
        requiredSkills: requiredSkills || undefined,
      })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      setSuccess(true)
      onCreated()
      // Brief success flash, then close
      setTimeout(() => onClose(), 900)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-template-title"
      onClick={e => {
        if (e.target === e.currentTarget && !pending) onClose()
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          aria-label="Close"
          className="absolute top-4 right-4 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <XIcon className="h-5 w-5" />
        </button>

        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <PlusIcon className="h-5 w-5 text-emerald-600" aria-hidden />
            </div>
            <div>
              <h2
                id="new-template-title"
                className="text-lg font-semibold text-slate-900 dark:text-slate-50"
              >
                New job template
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Save a job description once and reuse it for every new opening.
              </p>
            </div>
          </div>

          {success && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2Icon className="h-4 w-4 shrink-0" />
              Template saved! It now appears in your library.
            </div>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                Title
              </span>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Senior Frontend Engineer"
                required
                minLength={2}
                maxLength={200}
                disabled={pending}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
              />
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Level
                </span>
                <select
                  value={level}
                  onChange={e => setLevel(e.target.value)}
                  disabled={pending}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                >
                  {LEVEL_OPTIONS.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Category
                </span>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  disabled={pending}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                >
                  {CATEGORY_OPTIONS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                Summary <span className="text-slate-400">(1-2 sentences)</span>
              </span>
              <input
                type="text"
                value={summary}
                onChange={e => setSummary(e.target.value)}
                placeholder="A one-liner that appears on cards in the library."
                required
                minLength={10}
                maxLength={500}
                disabled={pending}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                Description
              </span>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="The full job description — responsibilities, what success looks like, your team, etc."
                required
                minLength={10}
                maxLength={8000}
                rows={8}
                disabled={pending}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                Required skills <span className="text-slate-400">(comma-separated, optional)</span>
              </span>
              <input
                type="text"
                value={requiredSkills}
                onChange={e => setRequiredSkills(e.target.value)}
                placeholder="React, TypeScript, PostgreSQL, AWS"
                maxLength={500}
                disabled={pending}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
              />
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertCircleIcon className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden />}
                {pending ? 'Saving…' : 'Save template'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
