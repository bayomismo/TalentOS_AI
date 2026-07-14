'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FilterIcon, MailIcon, SearchIcon, StarIcon, UserPlusIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/features/shared/components/status-badge'
import { getCandidates } from '@/mocks/seed-data'
import { cn } from '@/lib/utils'

type Stage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired'
type ViewMode = 'grid' | 'list'

const STAGE_FILTERS: { id: 'all' | Stage; label: string }[] = [
  { id: 'all', label: 'All stages' },
  { id: 'applied', label: 'Applied' },
  { id: 'screening', label: 'Screening' },
  { id: 'interview', label: 'Interview' },
  { id: 'offer', label: 'Offer' },
  { id: 'hired', label: 'Hired' },
]

export default function CandidatesPage() {
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState<'all' | Stage>('all')
  const [view, setView] = useState<ViewMode>('grid')

  const candidates = useMemo(() => getCandidates(), [])

  const filtered = useMemo(() => {
    return candidates.filter(c => {
      if (stage !== 'all' && c.stage !== stage) return false
      if (
        search &&
        !`${c.name} ${c.email} ${c.position}`.toLowerCase().includes(search.toLowerCase())
      ) {
        return false
      }
      return true
    })
  }, [candidates, search, stage])

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Candidates"
        description="Every person in your hiring pipeline — searchable, filterable, and ready to move forward. Click a candidate to open their full profile."
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {candidates.length} active
          </span>
        }
        actions={
          <>
            <Button variant="outline">
              <FilterIcon className="h-4 w-4" />
              Saved views
            </Button>
            <Button>
              <UserPlusIcon className="h-4 w-4" />
              Add candidate
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="space-y-5 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1 lg:max-w-md">
              <SearchIcon className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, email, or role…"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1.5">
                {STAGE_FILTERS.map(s => {
                  const active = s.id === stage
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStage(s.id)}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                        active
                          ? 'bg-emerald-500 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                      )}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>

              <div className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setView('grid')}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                    view === 'grid'
                      ? 'bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-slate-50'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-50'
                  )}
                >
                  Grid
                </button>
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                    view === 'list'
                      ? 'bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-slate-50'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-50'
                  )}
                >
                  List
                </button>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400">
            {filtered.length} of {candidates.length} candidates
          </div>

          {filtered.length > 0 ? (
            view === 'grid' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filtered.map(c => (
                  <CandidateCard key={c.id} candidate={c} />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">
                        Candidate
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">
                        Role
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">
                        Stage
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">
                        Rating
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">
                        Applied
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filtered.map(c => (
                      <tr
                        key={c.id}
                        className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/candidates/${c.id}`}
                            className="flex items-center gap-3"
                          >
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-base">
                              {c.avatar}
                            </div>
                            <div>
                              <p className="font-medium text-slate-900 hover:text-emerald-600 dark:text-slate-50 dark:hover:text-emerald-400">
                                {c.name}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {c.email}
                              </p>
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {c.position}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge stage={c.stage} />
                        </td>
                        <td className="px-4 py-3">
                          <RatingStars rating={c.rating} />
                        </td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                          {c.appliedAt.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center dark:border-slate-700 dark:bg-slate-800/40">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                No candidates match these filters
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Try a different stage or clear your search.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function CandidateCard({
  candidate,
}: {
  candidate: ReturnType<typeof getCandidates>[number]
}) {
  return (
    <Link
      href={`/candidates/${candidate.id}`}
      className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-2xl">
          {candidate.avatar}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900 group-hover:text-emerald-600 dark:text-slate-50 dark:group-hover:text-emerald-400">
            {candidate.name}
          </h3>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {candidate.position}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <StatusBadge stage={candidate.stage} />
            <RatingStars rating={candidate.rating} compact />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-700/50 dark:text-slate-400">
        <MailIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{candidate.email}</span>
      </div>
    </Link>
  )
}

function RatingStars({ rating, compact = false }: { rating: number; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-0.5 text-amber-500">
        {Array.from({ length: 5 }).map((_, i) => (
          <StarIcon
            key={i}
            className={cn('h-3 w-3', i < rating ? 'fill-current' : 'opacity-30')}
          />
        ))}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-0.5 text-amber-500">
      {Array.from({ length: 5 }).map((_, i) => (
        <StarIcon
          key={i}
          className={cn('h-3.5 w-3.5', i < rating ? 'fill-current' : 'opacity-30')}
        />
      ))}
    </div>
  )
}
