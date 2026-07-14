import type * as React from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
  meta?: React.ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  badge,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-start md:justify-between dark:border-slate-700',
        className
      )}
    >
      <div className="min-w-0 flex-1 space-y-2">
        {badge}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl dark:text-slate-50">
          {title}
        </h1>
        {description && (
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
            {description}
          </p>
        )}
        {meta && <div className="flex flex-wrap items-center gap-3 pt-1">{meta}</div>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 md:flex-shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}
