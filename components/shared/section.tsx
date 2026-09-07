import type * as React from 'react'
import { cn } from '@/lib/utils'

interface SectionProps {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}

export function Section({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: SectionProps) {
  return (
    <section className={cn('space-y-4', className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            {title && (
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {description}
              </p>
            )}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={contentClassName}>{children}</div>
    </section>
  )
}
