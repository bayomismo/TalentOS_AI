'use client'

import { type ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'
import { SparklesIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Step {
  id: 'workspace' | 'company' | 'team' | 'done'
  label: string
}

export function OnboardingShell({
  currentStep,
  steps,
  children,
}: {
  currentStep: string
  steps: Step[]
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <div className="mb-8 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 mb-3">
            <SparklesIcon className="h-6 w-6 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Welcome to TalentOS
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Let's set up your workspace in a few quick steps.
          </p>
        </div>

        <ol className="mb-8 flex items-center justify-center gap-2 sm:gap-4">
          {steps.map((s, i) => {
            const isActive = s.id === currentStep
            const isPast = steps.findIndex(x => x.id === currentStep) > i
            return (
              <li key={s.id} className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                    isPast
                      ? 'bg-emerald-500 text-white'
                      : isActive
                        ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
                  )}
                >
                  {isPast ? <CheckIcon className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span
                  className={cn(
                    'text-xs font-medium',
                    isActive
                      ? 'text-slate-900 dark:text-slate-50'
                      : 'text-slate-500 dark:text-slate-400',
                  )}
                >
                  {s.label}
                </span>
                {i < steps.length - 1 && (
                  <div className="h-px w-6 bg-slate-200 dark:bg-slate-700 sm:w-10" />
                )}
              </li>
            )
          })}
        </ol>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-8">
          {children}
        </div>
      </div>
    </div>
  )
}
