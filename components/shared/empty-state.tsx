import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  emoji?: string
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
  variant?: 'card' | 'plain'
}

export function EmptyState({
  icon: Icon,
  emoji,
  title,
  description,
  actions,
  className,
  variant = 'card',
}: EmptyStateProps) {
  const containerClass = cn(
    variant === 'card' &&
      'rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 dark:border-slate-700 dark:bg-slate-800/40',
    variant === 'plain' && 'px-6 py-10',
    'flex flex-col items-center justify-center text-center',
    className
  )

  return (
    <div className={containerClass}>
      {(Icon || emoji) && (
        <div
          className={cn(
            'mb-4 flex h-14 w-14 items-center justify-center rounded-2xl',
            variant === 'card'
              ? 'bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700'
              : 'bg-slate-100 dark:bg-slate-800'
          )}
        >
          {Icon ? (
            <Icon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <span className="text-2xl">{emoji}</span>
          )}
        </div>
      )}

      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
        {title}
      </h3>

      {description && (
        <p className="mt-1.5 max-w-md text-sm text-slate-500 dark:text-slate-400">
          {description}
        </p>
      )}

      {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  )
}
