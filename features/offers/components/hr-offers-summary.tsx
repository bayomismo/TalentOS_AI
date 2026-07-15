'use client'

/**
 * Sprint 10 — Offers summary card for a Hiring Request.
 *
 * Renders tenant-scoped counts: selected candidates, draft offers,
 * issued offers, accepted offers, and remaining openings. The HR
 * is NOT automatically closed when accepted = openings (PART 19).
 */

import { useEffect, useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shared/card'
import { BriefcaseIcon } from 'lucide-react'
import { getHiringRequestOfferCountsAction } from '@/features/offers/actions/offer-actions'

interface Props {
  hiringRequestId: string
}

export function HROffersSummary({ hiringRequestId }: Props) {
  const [counts, setCounts] = useState<Awaited<ReturnType<typeof getHiringRequestOfferCountsAction>> | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      const r = await getHiringRequestOfferCountsAction(hiringRequestId)
      if (r.ok) setCounts(r)
    })
  }, [hiringRequestId])

  if (!counts?.ok) return null
  const c = counts.data
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BriefcaseIcon className="h-4 w-4 text-slate-500" />
          Offers
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Openings" value={c.openings} />
          <Stat label="Selected" value={c.selected} accent="emerald" />
          <Stat label="Draft offers" value={c.draft} />
          <Stat label="Issued" value={c.issued} accent="indigo" />
          <Stat label="Accepted" value={c.accepted} accent="emerald" />
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {c.remaining} of {c.openings} opening{c.openings === 1 ? '' : 's'} remaining.
          Hiring Requests are not auto-closed when an offer is accepted.
        </p>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: 'emerald' | 'indigo' }) {
  const tone =
    accent === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' :
    accent === 'indigo'  ? 'text-indigo-700 dark:text-indigo-300' :
    'text-slate-900 dark:text-slate-50'
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  )
}
