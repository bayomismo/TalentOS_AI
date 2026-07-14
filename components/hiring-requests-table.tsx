'use client'

import { Position } from '@/lib/data'
import { StatusBadge } from './status-badge'

interface HiringRequestsTableProps {
  positions: Position[]
}

export function HiringRequestsTable({ positions }: HiringRequestsTableProps) {
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
            <th className="px-4 py-3 text-center font-semibold text-slate-900 dark:text-slate-50">
              Candidates
            </th>
            <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">
              Status
            </th>
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
              <td className="px-4 py-3 text-center">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {position.candidates}
                </span>
              </td>
              <td className="px-4 py-3">
                <StatusBadge stage={position.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
