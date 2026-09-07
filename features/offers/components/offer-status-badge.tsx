'use client'

import { OfferStatus } from '@prisma/client'

const STYLE: Record<OfferStatus, { bg: string; text: string; label: string }> = {
  DRAFT:            { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-700 dark:text-slate-200', label: 'Draft' },
  PENDING_APPROVAL: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-800 dark:text-amber-200', label: 'Pending Approval' },
  APPROVED:         { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-800 dark:text-blue-200', label: 'Approved' },
  ISSUED:           { bg: 'bg-indigo-100 dark:bg-indigo-900/40', text: 'text-indigo-800 dark:text-indigo-200', label: 'Issued' },
  SENT:             { bg: 'bg-indigo-100 dark:bg-indigo-900/40', text: 'text-indigo-800 dark:text-indigo-200', label: 'Sent' },
  UNDER_REVIEW:     { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-700 dark:text-slate-200', label: 'Under Review' },
  ACCEPTED:         { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-800 dark:text-emerald-200', label: 'Accepted' },
  DECLINED:         { bg: 'bg-rose-100 dark:bg-rose-900/40', text: 'text-rose-800 dark:text-rose-200', label: 'Declined' },
  WITHDRAWN:        { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-700 dark:text-slate-200', label: 'Withdrawn' },
  EXPIRED:          { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-700 dark:text-slate-200', label: 'Expired' },
}

export function OfferStatusBadge({ status }: { status: OfferStatus | string }) {
  const s = (STYLE as any)[status] ?? { bg: 'bg-slate-100', text: 'text-slate-700', label: String(status) }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}
