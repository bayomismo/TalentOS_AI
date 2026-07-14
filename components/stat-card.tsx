'use client'

import { cn } from '@/lib/utils'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  change?: number
  trend?: 'up' | 'down'
  icon?: React.ReactNode
  className?: string
}

export function StatCard({
  label,
  value,
  change,
  trend,
  icon,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-700 dark:bg-slate-800',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
            {label}
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {value}
            </p>
            {change !== undefined && (
              <div
                className={cn(
                  'flex items-center gap-1 text-xs font-semibold',
                  trend === 'up'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-600 dark:text-slate-400'
                )}
              >
                {trend === 'up' ? (
                  <ArrowUpIcon className="h-3 w-3" />
                ) : (
                  <ArrowDownIcon className="h-3 w-3" />
                )}
                {Math.abs(change)}%
              </div>
            )}
          </div>
        </div>
        {icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}
