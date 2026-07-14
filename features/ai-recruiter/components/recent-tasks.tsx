'use client'

import { motion } from 'framer-motion'
import { CheckCircle2Icon, ClockIcon, FileIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RecentTask } from '../types'

interface RecentTasksProps {
  tasks: RecentTask[]
}

const statusConfig = {
  complete: {
    icon: CheckCircle2Icon,
    label: 'Complete',
    className: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  running: {
    icon: ClockIcon,
    label: 'In progress',
    className: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  draft: {
    icon: FileIcon,
    label: 'Draft',
    className: 'text-slate-500 dark:text-slate-400',
    dot: 'bg-slate-400',
  },
}

export function RecentTasks({ tasks }: RecentTasksProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="space-y-3"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
        Recent AI tasks
      </p>
      <div className="space-y-2">
        {tasks.map((task, i) => {
          const config = statusConfig[task.status]
          const Icon = config.icon

          return (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + i * 0.05 }}
              className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
            >
              <div
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  config.dot,
                  task.status === 'running' && 'animate-pulse'
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
                  {task.title}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {task.timestamp} · {task.artifactCount} artifacts
                </p>
              </div>
              <div
                className={cn(
                  'flex items-center gap-1 text-xs font-medium',
                  config.className
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{config.label}</span>
              </div>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}
