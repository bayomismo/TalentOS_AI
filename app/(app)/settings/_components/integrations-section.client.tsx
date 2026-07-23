'use client'

/**
 * Sprint 17 — Integrations section for /settings.
 *
 * Shows the Google Calendar integration card with connect / disconnect
 * / sync-status UI. "Connect" is a real link to /api/google/connect
 * (which redirects to Google).
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CalendarIcon, CheckCircle2Icon, ExternalLinkIcon, Loader2Icon, AlertTriangleIcon } from 'lucide-react'
import {
  getIntegrationsStatusAction,
  disconnectGoogleAction,
  type IntegrationsStatus,
} from './integrations-section'

export function IntegrationsSection({ initialError }: { initialError?: string }) {
  const [data, setData] = useState<IntegrationsStatus | null>(null)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(initialError ?? null)
    if (initialError) {
      // try to read the friendly version
      try {
        const decoded = decodeURIComponent(initialError)
        setError(decoded)
      } catch {
        setError(initialError)
      }
    }
    getIntegrationsStatusAction()
      .then(r => {
        if (cancelled) return
        if (r.ok) setData(r.data)
        else setError('Could not load integrations status')
      })
      .catch(() => {
        if (!cancelled) setError('Could not load integrations status')
      })
    return () => { cancelled = true }
  }, [initialError])

  async function disconnect() {
    setPending(true)
    setError(null)
    try {
      const r = await disconnectGoogleAction()
      if (!r.ok) {
        setError(r.error)
        return
      }
      // refresh status
      const s = await getIntegrationsStatusAction()
      if (s.ok) setData(s.data)
    } finally {
      setPending(false)
    }
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      </div>
    )
  }

  const g = data.google
  const isAdmin = true // section is gated to ADMINs by the action

  return (
    <div className="space-y-4">
      {/* Google Calendar card */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/40">
            <CalendarIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50">
              Google Calendar
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Sync scheduled interviews to your team&apos;s Google Calendar so they never miss a session.
            </p>
          </div>
        </div>

        <div className="mt-4">
          {g.status === 'not_configured' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300">
              <div className="flex items-start gap-2">
                <AlertTriangleIcon className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Not configured on this server</p>
                  <p className="mt-1 text-xs">
                    {g.reason}
                  </p>
                </div>
              </div>
            </div>
          )}

          {g.status === 'disconnected' && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500 dark:text-slate-400">Not connected</p>
              {isAdmin && (
                <a
                  href="/api/google/connect"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                  Connect Google Calendar
                </a>
              )}
            </div>
          )}

          {g.status === 'connected' && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2Icon className="h-4 w-4 text-emerald-500" />
                <span className="text-slate-700 dark:text-slate-200">
                  Connected as <strong>{g.googleEmail}</strong>
                </span>
                {g.googleName && (
                  <span className="text-slate-500 dark:text-slate-400">· {g.googleName}</span>
                )}
              </div>
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={disconnect} disabled={pending}>
                  {pending && <Loader2Icon className="h-3 w-3 animate-spin" />}
                  Disconnect
                </Button>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Sprint 17 · When an interview is created or rescheduled in TalentOS, the event is pushed to the connected Google Calendar. Deleting an interview in TalentOS removes the Google event too.
        </p>
      </div>
    </div>
  )
}
