'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { CheckIcon, Loader2Icon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StepStatus, WorkflowStep } from '../types'

interface ProgressTimelineProps {
  steps: WorkflowStep[]
  stepStatuses: StepStatus[]
  activeStepIndex: number
  visible: boolean
}

export function ProgressTimeline({
  steps,
  stepStatuses,
  activeStepIndex,
  visible,
}: ProgressTimelineProps) {
  if (!visible) return null

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
            AI task progress
          </p>
          <motion.span
            key={stepStatuses.filter(s => s === 'complete').length}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-xs font-semibold text-emerald-600 dark:text-emerald-400"
          >
            Step {Math.min(stepStatuses.filter(s => s === 'complete').length + 1, steps.length)} of{' '}
            {steps.length}
          </motion.span>
        </div>

        <div className="space-y-1">
          <AnimatePresence mode="popLayout">
            {steps.map((step, index) => {
              const status = stepStatuses[index]
              const isActive = status === 'active'
              const isComplete = status === 'complete'

              return (
                <motion.div
                  key={step.id}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05, duration: 0.3 }}
                  className={cn(
                    'flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors',
                    isActive && 'bg-emerald-50/80 dark:bg-emerald-950/30',
                    isComplete && 'opacity-70'
                  )}
                >
                  <div className="relative mt-0.5 flex flex-col items-center">
                    <motion.div
                      animate={
                        isActive
                          ? {
                              boxShadow: [
                                '0 0 0 0 rgba(16, 185, 129, 0.4)',
                                '0 0 0 8px rgba(16, 185, 129, 0)',
                              ],
                            }
                          : {}
                      }
                      transition={
                        isActive
                          ? { duration: 1.5, repeat: Infinity }
                          : {}
                      }
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                        isComplete &&
                          'bg-emerald-500 text-white',
                        isActive &&
                          'bg-emerald-500 text-white',
                        !isComplete &&
                          !isActive &&
                          'border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-500'
                      )}
                    >
                      {isComplete ? (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                        >
                          <CheckIcon className="h-3.5 w-3.5" />
                        </motion.div>
                      ) : isActive ? (
                        <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        index + 1
                      )}
                    </motion.div>
                    {index < steps.length - 1 && (
                      <div
                        className={cn(
                          'mt-1 h-4 w-0.5',
                          isComplete
                            ? 'bg-emerald-500'
                            : 'bg-slate-200 dark:bg-slate-700'
                        )}
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 pt-0.5">
                    <p
                      className={cn(
                        'text-sm font-medium',
                        isActive
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : isComplete
                            ? 'text-slate-600 dark:text-slate-400'
                            : 'text-slate-500 dark:text-slate-500'
                      )}
                    >
                      {step.label}
                    </p>
                    <AnimatePresence>
                      {isActive && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-0.5 text-xs text-slate-500 dark:text-slate-400"
                        >
                          {step.description}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>

                  {isActive && activeStepIndex === index && (
                    <motion.div
                      className="mt-1 h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"
                    >
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                        initial={{ width: '0%' }}
                        animate={{ width: '100%' }}
                        transition={{
                          duration: step.durationMs / 1000,
                          ease: 'easeInOut',
                        }}
                      />
                    </motion.div>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
