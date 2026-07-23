'use client'

/**
 * Import from URL modal — Sprint 15 P1 fix.
 *
 * Replaces the previously dead "Import from URL" button. Asks for
 * a public job-posting URL, fetches the HTML on the server, extracts
 * title + description + skills, and saves it as a new template.
 *
 * Best-effort parsing: it works well on standard job board pages
 * (LinkedIn, Indeed, Lever, Greenhouse, Ashby, company career sites).
 * For pages behind anti-bot or with heavy JS rendering, the user can
 * fall back to "New template" and paste manually.
 *
 * Full a11y: role=dialog, aria-modal, body scroll lock, Escape to
 * close, click outside to close.
 */

import { useEffect, useState, useTransition } from 'react'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileTextIcon,
  Loader2Icon,
  XIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { importJobFromUrlAction, type ImportJobFromUrlResult } from '../actions'

interface ImportUrlModalProps {
  open: boolean
  onClose: () => void
  onImported: () => void
}

export function ImportUrlModal({ open, onClose, onImported }: ImportUrlModalProps) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ImportJobFromUrlResult | null>(null)

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
      setUrl('')
      setError(null)
      setResult(null)
    }
  }, [open])

  if (!open) return null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    startTransition(async () => {
      const r: ImportJobFromUrlResult = await importJobFromUrlAction({ url })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      setResult(r)
      onImported()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-url-title"
      onClick={e => {
        if (e.target === e.currentTarget && !pending) onClose()
      }}
    >
      <div className="relative w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
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
              <FileTextIcon className="h-5 w-5 text-emerald-600" aria-hidden />
            </div>
            <div>
              <h2
                id="import-url-title"
                className="text-lg font-semibold text-slate-900 dark:text-slate-50"
              >
                Import job from URL
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Paste any public job posting. We'll extract the title, description, and skills.
              </p>
            </div>
          </div>

          {result?.ok ? (
            <div className="mt-6 space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
                <CheckCircle2Icon className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium">Imported "{result.title}"</p>
                  {result.extracted.skills.length > 0 && (
                    <p className="mt-1 text-xs">
                      {result.extracted.skills.length} skill{result.extracted.skills.length === 1 ? '' : 's'} extracted.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Job posting URL
                </span>
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://jobs.lever.co/example/senior-frontend-engineer"
                  required
                  maxLength={500}
                  disabled={pending}
                  autoFocus
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
                />
              </label>

              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-400">
                <strong className="font-medium">How it works:</strong> we fetch the page server-side,
                extract the title from <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">&lt;title&gt;</code> /
                OpenGraph tags, pull the description, and look for a "Requirements" section to pull skills.
                Works best on standard job boards and company career pages.
              </div>

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
                  {pending ? 'Fetching…' : 'Import'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
