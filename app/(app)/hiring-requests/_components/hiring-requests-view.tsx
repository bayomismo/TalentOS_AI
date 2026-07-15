'use client'

/**
 * Hiring Requests view — client component, data from Prisma.
 *
 * Fetches via `getHiringRequestsAction` on mount and re-renders whenever
 * the AI Recruiter wizard publishes a `HiringRequestCreated` event.
 */

import { useEffect, useState, useTransition } from 'react'
import { FilterIcon, PlusIcon, SearchIcon, SlidersHorizontalIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { HiringRequestsTable } from '@/features/hiring-requests/components/hiring-requests-table'
import { StatCard } from '@/features/dashboard/components/stat-card'
import { getHiringRequestsAction, type HiringRequestsPayload } from '../actions'
import { useTalentOSEvent } from '@/lib/events'
import type { HiringRequestSnapshot } from '@/lib/events/types'
import { cn } from '@/lib/utils'
import type { Position } from '@/types'

type StatusFilter = 'all' | 'active' | 'closed'
type DepartmentFilter = 'all' | 'Engineering' | 'Product' | 'Design' | 'Data'

const EMPTY: HiringRequestsPayload = {
  positions: [],
  stats: { total: 0, active: 0, openings: 0, candidates: 0 },
}

export function HiringRequestsView() {
  const [data, setData] = useState<HiringRequestsPayload | null>(null)
  const [, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [department, setDepartment] = useState<DepartmentFilter>('all')

  useEffect(() => {
    startTransition(async () => {
      try {
        setData(await getHiringRequestsAction())
      } catch (err) {
        console.error('[hiring-requests] failed to load data', err)
        setData(EMPTY)
      }
    })
  }, [])

  // Live updates: when the AI Recruiter wizard creates a new request,
  // prepend it to the list without re-fetching.
  useTalentOSEvent('HiringRequestCreated', event => {
    setData(prev => {
      if (!prev) return prev
      const newRow = snapshotToRow(event.payload.hiringRequest)
      if (prev.positions.some(p => p.id === newRow.id)) return prev
      return {
        positions: [newRow, ...prev.positions],
        stats: {
          total: prev.stats.total + 1,
          active: prev.stats.active + (newRow.status === 'active' ? 1 : 0),
          openings: prev.stats.openings + newRow.openings,
          candidates: prev.stats.candidates,
        },
      }
    })
  })

  if (!data) {
    return (
      <div className="space-y-8 p-8">
        <PageHeader
          title="Hiring Requests"
          description="Loading hiring requests…"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
            />
          ))}
        </div>
      </div>
    )
  }

  const filtered = data.positions.filter(p => {
    if (status !== 'all' && p.status !== status) return false
    if (department !== 'all' && p.department !== department) return false
    if (
      search &&
      !`${p.title} ${p.department}`.toLowerCase().includes(search.toLowerCase())
    ) {
      return false
    }
    return true
  })

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Hiring Requests"
        description="Track every open role in one place. Filter by department, status, or search across job titles to see exactly what your team is hiring for."
        actions={
          <>
            <Button variant="outline">
              <SlidersHorizontalIcon className="h-4 w-4" aria-hidden />
              Customize view
            </Button>
            <Button>
              <PlusIcon className="h-4 w-4" aria-hidden />
              New hiring request
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total requests" value={data.stats.total} />
        <StatCard label="Active roles" value={data.stats.active} change={12} trend="up" />
        <StatCard label="Total openings" value={data.stats.openings} change={5} trend="up" />
        <StatCard label="Candidates in pipeline" value={data.stats.candidates} change={9} trend="up" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1 lg:max-w-md">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by job title or department…"
                aria-label="Search hiring requests"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterPill
                label="Status"
                value={status === 'all' ? 'All' : status[0]!.toUpperCase() + status.slice(1)}
                options={[
                  { label: 'All', value: 'all' },
                  { label: 'Active', value: 'active' },
                  { label: 'Closed', value: 'closed' },
                ]}
                onChange={v => setStatus(v as StatusFilter)}
              />
              <FilterPill
                label="Department"
                value={department === 'all' ? 'All' : department}
                options={[
                  { label: 'All', value: 'all' },
                  { label: 'Engineering', value: 'Engineering' },
                  { label: 'Product', value: 'Product' },
                  { label: 'Design', value: 'Design' },
                  { label: 'Data', value: 'Data' },
                ]}
                onChange={v => setDepartment(v as DepartmentFilter)}
              />
            </div>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400">
            Showing {filtered.length} of {data.positions.length} requests
          </div>

          {filtered.length > 0 ? (
            <HiringRequestsTable positions={toPositions(filtered)} showCandidateActions />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center dark:border-slate-700 dark:bg-slate-800/40">
              <FilterIcon className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-50">
                No hiring requests match your filters
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Try adjusting the status, department, or search query.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function snapshotToRow(s: HiringRequestSnapshot) {
  return {
    id: s.id,
    title: s.title,
    department: s.department,
    openings: s.openings,
    filled: s.filled ?? 0,
    candidates: 0,
    analyzed: 0,
    shortlisted: 0,
    status: (s.status === 'CLOSED' || s.status === 'CANCELLED' || s.status === 'FILLED'
      ? 'closed' as const
      : 'active' as const),
    createdAt: s.createdAt,
  }
}

function toPositions(rows: HiringRequestsPayload['positions']): Position[] {
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    department: r.department,
    openings: r.openings,
    filled: r.filled ?? 0,
    candidates: r.candidates,
    analyzed: r.analyzed,
    shortlisted: r.shortlisted,
    status: r.status,
    createdAt: new Date(r.createdAt),
  }))
}

interface FilterPillProps {
  label: string
  value: string
  options: { label: string; value: string }[]
  onChange: (value: string) => void
}

function FilterPill({ label, value, options, onChange }: FilterPillProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
        )}
      >
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          {label}:
        </span>
        <span className="font-medium">{value}</span>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="listbox"
            className="absolute right-0 z-20 mt-1.5 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors',
                  opt.value === value
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
