'use client'

import Link from 'next/link'
import { ArrowRightIcon, UsersIcon } from 'lucide-react'
import type { Position } from '@/types'
import { StatusBadge } from '@/features/shared/components/status-badge'
import { cn } from '@/lib/utils'

interface HiringRequestsTableProps {
  positions: Position[]
  /** When true, render a row-level "Candidate Workspace" CTA + count cells. */
  showCandidateActions?: boolean
}

export function HiringRequestsTable({ positions, showCandidateActions = false }: HiringRequestsTableProps) {
  if (positions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center dark:border-slate-700 dark:bg-slate-800/40">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-50">No hiring requests yet</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Generate one from the AI Recruiter wizard to get started.
        </p>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">
              Position
            </th>
            <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">
              Department
            </th>
            <th className="px-4 py-3 text-center font-semibold text-slate-900 dark:text-slate-50">
              Openings
            </th>
            {showCandidateActions && (
              <>
                <th
                  className="px-4 py-3 text-center font-semibold text-slate-900 dark:text-slate-50"
                  title="Total candidates"
                >
                  Candidates
                </th>
                <th
                  className="px-4 py-3 text-center font-semibold text-slate-900 dark:text-slate-50"
                  title="Candidates that have an AI match score"
                >
                  Analyzed
                </th>
                <th
                  className="px-4 py-3 text-center font-semibold text-slate-900 dark:text-slate-50"
                  title="Candidates in Screening / Interview / Offer / Hired"
                >
                  Shortlisted
                </th>
              </>
            )}
            <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">
              Status
            </th>
            {showCandidateActions && (
              <th className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-50">
                Action
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
          {positions.map(position => (
            <tr
              key={position.id}
              className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-50">
                {position.title}
              </td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                {position.department}
              </td>
              <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-400">
                {position.openings}
              </td>
              {showCandidateActions && (
                <>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={cn(
                        'font-semibold tabular-nums',
                        position.candidates > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-400'
                      )}
                    >
                      {position.candidates}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={cn(
                        'font-semibold tabular-nums',
                        position.analyzed && position.analyzed > 0
                          ? 'text-sky-600 dark:text-sky-400'
                          : 'text-slate-400'
                      )}
                    >
                      {position.analyzed ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={cn(
                        'font-semibold tabular-nums',
                        position.shortlisted && position.shortlisted > 0
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-400'
                      )}
                    >
                      {position.shortlisted ?? 0}
                    </span>
                  </td>
                </>
              )}
              <td className="px-4 py-3">
                <StatusBadge stage={position.status} />
              </td>
              {showCandidateActions && (
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/hiring-requests/${position.id}/candidates`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                    aria-label={`Open Candidate Workspace for ${position.title}`}
                  >
                    <UsersIcon className="h-3.5 w-3.5" aria-hidden />
                    Candidate Workspace
                    <ArrowRightIcon className="h-3 w-3" aria-hidden />
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
