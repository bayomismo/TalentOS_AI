'use client'

import type { Candidate } from '@/types'
import { StatusBadge } from '@/features/shared/components/status-badge'

interface PipelineColumnProps {
  title: string
  stage: Candidate['stage']
  candidates: Candidate[]
  count: number
}

export function PipelineColumn({
  title,
  stage,
  candidates,
  count,
}: PipelineColumnProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          {title}
        </h3>
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
          {count}
        </span>
      </div>
      <div className="space-y-2">
        {candidates.map(candidate => (
          <div
            key={candidate.id}
            className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-all hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-lg">{candidate.avatar}</div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
                  {candidate.name}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {candidate.email}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <StatusBadge stage={stage} />
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {'⭐'.repeat(candidate.rating)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
        {candidates.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-700 dark:bg-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No candidates
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
