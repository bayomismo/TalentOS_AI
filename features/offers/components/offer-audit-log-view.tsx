'use client'

/**
 * Sprint 19 — The offer audit log (audit P1-14).
 *
 * `audit.view` was granted to ADMIN/TA_LEAD and every offer transition
 * wrote an AuditLog row, but NOTHING could read the table back: it was
 * a write-only ledger, and reconstructing "who did what" required
 * direct database access.
 *
 * This component is that reader. It is organization-scoped (the action
 * layer filters by the caller's organization), requires `audit.view`,
 * and shows the before/after payload of every edit so the trail can
 * answer "who changed the salary, from what to what".
 *
 * Shared by `/offers/audit` (offer-scoped route) and `/audit` (the
 * organization-wide route).
 */

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { getOrgOfferAuditLogAction, type OfferAuditEntry } from '@/features/offers/actions/offer-actions'

const ACTION_FILTERS = [
  { value: '', label: 'All' },
  { value: 'OFFER_CREATED', label: 'Created' },
  { value: 'OFFER_EDITED', label: 'Edited' },
  { value: 'OFFER_DRAFT_GENERATED', label: 'AI draft' },
  { value: 'OFFER_SUBMITTED_FOR_APPROVAL', label: 'Submitted' },
  { value: 'OFFER_RETURNED_FOR_CHANGES', label: 'Returned' },
  { value: 'OFFER_APPROVED', label: 'Approved' },
  { value: 'OFFER_SELF_APPROVED_BY_ADMIN', label: 'Self-approved' },
  { value: 'OFFER_ISSUED', label: 'Issued' },
  { value: 'OFFER_ACCEPTED', label: 'Accepted' },
  { value: 'OFFER_DECLINED', label: 'Declined' },
  { value: 'OFFER_WITHDRAWN', label: 'Withdrawn' },
  { value: 'OFFER_EXPIRED', label: 'Expired' },
]

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export function OfferAuditLogView({ backHref }: { backHref?: string }) {
  const router = useRouter()
  const [entries, setEntries] = useState<OfferAuditEntry[]>([])
  const [action, setAction] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      const res = await getOrgOfferAuditLogAction({ action: action || undefined, limit: 200 })
      if (res.ok) setEntries(res.data)
      else setError(res.error.message)
    })
  }, [action])

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-center gap-2">
        {backHref && (
          <Button variant="ghost" size="sm" onClick={() => router.push(backHref)}>
            ← Back
          </Button>
        )}
        <div className="flex flex-wrap gap-2">
          {ACTION_FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setAction(f.value)}
              className={
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ' +
                (action === f.value
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200')
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Audit entries ({entries.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {pending && entries.length === 0 ? (
            <p className="text-sm text-slate-500">Loading audit entries…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-slate-500">
              No audit entries yet. Every offer change is recorded here as it happens.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-slate-200 bg-slate-50/50 text-left dark:border-slate-700 dark:bg-slate-800/50">
                  <tr className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3 font-semibold">When</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                    <th className="px-4 py-3 font-semibold">Actor</th>
                    <th className="px-4 py-3 font-semibold">Target</th>
                    <th className="px-4 py-3 font-semibold">What changed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {entries.map(e => (
                    <tr key={e.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        {fmtDateTime(e.occurredAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                          {e.action}
                        </span>
                        {e.outcome !== 'success' && (
                          <span className="ml-2 text-xs text-red-600 dark:text-red-400">{e.outcome}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{e.actorName ?? 'system'}</td>
                      <td className="px-4 py-3">
                        {e.targetId ? (
                          <button
                            type="button"
                            className="text-xs text-emerald-700 underline dark:text-emerald-300"
                            onClick={() => router.push(`/offers/${e.targetId}`)}
                          >
                            {e.targetType ?? 'target'} {e.targetId.slice(0, 8)}…
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        {e.reason ? <span className="block">{e.reason}</span> : null}
                        <Changes metadata={e.metadata} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Renders the before/after payload of an edit (audit P1-13): the trail
 * must answer "who changed the salary, from what to what".
 */
function Changes({ metadata }: { metadata: Record<string, unknown> }) {
  const changes = (metadata?.changes ?? null) as Record<string, { from: unknown; to: unknown }> | null
  if (!changes || typeof changes !== 'object' || Object.keys(changes).length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5">
      {Object.entries(changes).map(([field, change]) => (
        <li key={field}>
          <span className="font-medium">{field}</span>: {format(change?.from)} → {format(change?.to)}
        </li>
      ))}
    </ul>
  )
}

function format(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(none)'
  return String(value)
}
