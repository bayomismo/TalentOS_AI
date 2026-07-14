import type * as React from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'outline' | 'ghost'
}

export function Card({
  className,
  variant = 'default',
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border shadow-sm transition-shadow',
        variant === 'default' &&
          'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
        variant === 'outline' &&
          'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
        variant === 'ghost' &&
          'border-transparent bg-slate-50 dark:bg-slate-800/50',
        className
      )}
      {...props}
    />
  )
}

interface CardHeaderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

export function CardHeader({
  className,
  title,
  description,
  action,
  children,
  ...props
}: CardHeaderProps) {
  if (!title && !description && !action && !children) return null

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4 dark:border-slate-700/50',
        className
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">
        {title && (
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {title}
          </h3>
        )}
        {description && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {description}
          </p>
        )}
        {children}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'text-base font-semibold text-slate-900 dark:text-slate-50',
        className
      )}
      {...props}
    />
  )
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        'mt-1 text-sm text-slate-500 dark:text-slate-400',
        className
      )}
      {...props}
    />
  )
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6', className)} {...props} />
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 dark:border-slate-700/50',
        className
      )}
      {...props}
    />
  )
}
