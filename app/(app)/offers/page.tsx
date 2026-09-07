'use client'

/**
 * Sprint 10 — Offer Management Center (`/offers`).
 *
 * Organization-scoped list of all offers. Compensation fields are
 * masked at the server-side projection (see `listOffersAction`); a user
 * without `offer.view_compensation` will see status, dates, and
 * candidates but not salary.
 */

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shared/card'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { listOffersAction, getOfferMetricsAction, type OfferListItem } from '@/features/offers/actions/offer-actions'
import { OfferStatusBadge } from '@/features/offers/components/offer-status-badge'

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'ISSUED', label: 'Issued' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
  { value: 'EXPIRED', label: 'Expired' },
]

function formatMoney(amount: number, currency: string, period: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount) + (period ? ` / ${period}` : '')
  } catch {
    return `${amount} ${currency} / ${period}`
  }
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function OffersPage() {
  const router = useRouter()
  const [offers, setOffers] = useState<OfferListItem[]>([])
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof getOfferMetricsAction>> | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function load() {
    startTransition(async () => {
      const [list, m] = await Promise.all([
        listOffersAction({ status: statusFilter || undefined }),
        getOfferMetricsAction(),
      ])
      if (list.ok) setOffers(list.data.offers)
      else setError(list.error.message)
      if (m.ok) setMetrics(m)
    })
  }

  useEffect(() => { load() }, [statusFilter])

  const filtered = offers.filter(o => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      o.candidateName.toLowerCase().includes(q) ||
      o.title.toLowerCase().includes(q) ||
      o.hiringRequestTitle.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        title="Offers"
        description="Manage offer drafts, approvals, issuance, and candidate responses. Compensation is visible only to authorized roles."
      />

      {/* Metrics */}
      {metrics?.ok && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
          {[
            { label: 'Draft', value: metrics.data.draft },
            { label: 'Pending Approval', value: metrics.data.pendingApproval, highlight: metrics.data.pendingApproval > 0 },
            { label: 'Approved', value: metrics.data.approved },
            { label: 'Issued', value: metrics.data.issued },
            { label: 'Accepted', value: metrics.data.accepted },
            { label: 'Declined', value: metrics.data.declined },
            { label: 'Expiring Soon', value: metrics.data.expiringSoon, highlight: metrics.data.expiringSoon > 0 },
          ].map(m => (
            <Card key={m.label} className={m.highlight ? 'border-amber-300 dark:border-amber-700' : ''}>
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">{m.label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{m.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatusFilter(f.value)}
                  className={
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ' +
                    (statusFilter === f.value
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200')
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              placeholder="Search by candidate, position, or hiring request…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50 md:w-80"
            />
          </div>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle>All offers ({filtered.length})</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          {pending && offers.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading offers…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No offers match your filters.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-y border-slate-200 bg-slate-50/50 text-left dark:border-slate-700 dark:bg-slate-800/50">
                <tr className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3 font-semibold">Candidate</th>
                  <th className="px-4 py-3 font-semibold">Position</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Compensation</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3 font-semibold">Expires</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {filtered.map(o => (
                  <tr key={o.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/30">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-slate-50">{o.candidateName}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{o.hiringRequestTitle}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{o.title}</td>
                    <td className="px-4 py-3"><OfferStatusBadge status={o.status} /></td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {o.salaryAmount != null ? formatMoney(o.salaryAmount, o.salaryCurrency!, o.salaryPeriod!) : (
                        <span className="text-xs text-slate-400">restricted</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(o.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(o.expiresAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => router.push(`/offers/${o.id}`)}>View</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  )
}
