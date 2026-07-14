'use client'

import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  stage:
    | 'applied'
    | 'screening'
    | 'interview'
    | 'offer'
    | 'hired'
    | 'active'
    | 'closed'
  className?: string
}

export function StatusBadge({ stage, className }: StatusBadgeProps) {
  const styles = {
    applied: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
    screening:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200',
    interview:
      'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200',
    offer: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-200',
    hired: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
    closed: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  }

  const labels = {
    applied: 'Applied',
    screening: 'Screening',
    interview: 'Interview',
    offer: 'Offer',
    hired: 'Hired',
    active: 'Active',
    closed: 'Closed',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        styles[stage],
        className
      )}
    >
      {labels[stage]}
    </span>
  )
}
