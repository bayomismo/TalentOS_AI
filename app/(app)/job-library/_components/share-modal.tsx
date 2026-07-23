'use client'

/**
 * Sprint 17 — Share modal for public job posting.
 *
 * Lets the user enable/disable public posting of a job. When enabled,
 * shows the public URL with a Copy button.
 *
 * Full a11y: role=dialog, body scroll lock, Escape to close.
 */

import { useEffect, useState, useTransition } from 'react'
import {
  CheckCircle2Icon,
  CopyIcon,
  ExternalLinkIcon,
  LinkIcon,
  Loader2Icon,
  LockIcon,
  XIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { enablePublicPostingAction, disablePublicPostingAction } from '../actions'

interface ShareModalProps {
  open: boolean
  onClose: () => void
  jobId: string
  jobTitle: string
  initiallyEnabled: boolean
  initialSlug?: string | null
}

const APP_URL = 'https://talentos-ai-lime.vercel.app'

export function ShareModal({
  open,
  onClose,
  jobId,
  jobTitle,
  initiallyEnabled,
  initialSlug,
}: ShareModalProps) {
  const [enabled, setEnabled] = useState(initiallyEnabled)
  const [slug, setSlug] = useState(initialSlug ?? null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = original }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pending, onClose])

  useEffect(() => {
    if (open) {
      setEnabled(initiallyEnabled)
      setSlug(initialSlug ?? null)
      setError(null)
      setCopied(false)
    }
  }, [open, initiallyEnabled, initialSlug])

  if (!open) return null

  function enable() {
    setError(null)
    startTransition(async () => {
      const r = await enablePublicPostingAction(jobId)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setEnabled(true)
      setSlug(r.slug)
    })
  }

  function disable() {
    setError(null)
    startTransition(async () => {
      const r = await disablePublicPostingAction(jobId)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setEnabled(false)
    })
  }

  const publicUrl = slug ? `${APP_URL}/jobs/${slug}` : ''

  async function copy() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fallback
      const input = document.createElement('input')
      input.value = publicUrl
      document.body.appendChild(input)
      input.select()
      try { document.execCommand('copy'); setCopied(true) } catch {}
      document.body.removeChild(input)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      onClick={e => {
        if (e.target === e.currentTarget && !pending) onClose()
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
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
              {enabled
                ? <LinkIcon className="h-5 w-5 text-emerald-600" />
                : <LockIcon className="h-5 w-5 text-slate-500" />}
            </div>
            <div>
              <h2 id="share-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {enabled ? 'Public link active' : 'Share this role publicly'}
              </h2>
              <p className="line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                {jobTitle}
              </p>
            </div>
          </div>

          {enabled ? (
            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Public URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={publicUrl}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    onClick={e => (e.target as HTMLInputElement).select()}
                  />
                  <Button onClick={copy} variant="outline" size="sm">
                    {copied ? (
                      <><CheckCircle2Icon className="h-4 w-4 text-emerald-500" /> Copied</>
                    ) : (
                      <><CopyIcon className="h-4 w-4" /> Copy</>
                    )}
                  </Button>
                </div>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                >
                  Open in new tab <ExternalLinkIcon className="h-3 w-3" />
                </a>
              </div>

              <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900/40 dark:text-slate-400">
                <strong>Anyone with the link</strong> can view this job. They won&apos;t see your
                other candidates, hiring requests, or org data. To stop sharing, click
                &quot;Disable public link&quot;.
              </p>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
                <Button variant="ghost" onClick={onClose}>Done</Button>
                <Button variant="outline" onClick={disable} disabled={pending}>
                  {pending && <Loader2Icon className="h-4 w-4 animate-spin" />}
                  Disable public link
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Generate a public link you can share on LinkedIn, your company site, or
                email. No login required to view.
              </p>

              {error && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
                <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
                <Button onClick={enable} disabled={pending}>
                  {pending && <Loader2Icon className="h-4 w-4 animate-spin" />}
                  {pending ? 'Generating…' : 'Enable public link'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
