'use client'

/**
 * Sprint 19 — Email delivery section for /settings (audit P0-03).
 *
 * Shows whether email is actually being delivered, and what happened to
 * each recent send: which provider handled it, what it did with it
 * (QUEUED / DELIVERED / FAILED) and — when it failed — why.
 *
 * When no delivery provider is configured the section says so plainly
 * instead of implying that mail went out.
 */

import { useEffect, useState } from 'react'
import { AlertTriangleIcon, CheckCircle2Icon, MailIcon, RefreshCwIcon } from 'lucide-react'
import {
  getEmailDeliveryStatusAction,
  type EmailDeliveryStatus,
} from './email-delivery-actions'

export function EmailDeliverySection() {
  const [data, setData] = useState<EmailDeliveryStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const result = await getEmailDeliveryStatusAction()
      if (result.ok) {
        setData(result.data)
        setError(null)
      } else {
        setError(result.error.message)
      }
    } catch {
      setError('Could not load the email delivery status.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
            <MailIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50">Email delivery</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Whether the transactional emails TalentOS sends actually reach anyone.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}

        {data && (
          <>
            <div
              className={
                data.configured
                  ? 'mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300'
              }
            >
              {data.configured ? (
                <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div>
                <p className="font-medium">{data.headline}</p>
                <p className="mt-1 text-xs">{data.detail}</p>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Recent sends
                </h4>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  provider: {data.provider}
                </span>
              </div>

              {data.recent.length === 0 ? (
                <p className="mt-2 rounded-lg border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  No email has been sent for this workspace yet.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.recent.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-900 dark:text-slate-50">
                          {row.subject}
                        </span>
                        <span
                          className={
                            row.deliveryStatus === 'DELIVERED'
                              ? 'rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : row.deliveryStatus === 'FAILED'
                                ? 'rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                                : 'rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                          }
                        >
                          {row.deliveryStatus ?? row.status}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-500 dark:text-slate-400">
                        {row.kind} → {row.to} · provider {row.provider ?? 'unknown'} ·{' '}
                        {new Date(row.createdAt).toLocaleString()}
                      </p>
                      {row.failure && (
                        <p className="mt-1 text-rose-600 dark:text-rose-400">{row.failure}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
