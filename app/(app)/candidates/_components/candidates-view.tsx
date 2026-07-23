'use client'

/**
 * Candidates view — client component, data from Prisma.
 */

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { FilterIcon, MailIcon, SearchIcon, StarIcon, UploadIcon, UserPlusIcon, XIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/features/shared/components/status-badge'
import { getCandidatesAction, type CandidatesPayload } from '../actions'
import { AddCandidateModal } from './add-candidate-modal'
import { ImportCsvModal } from './import-csv-modal'
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

const EMPTY: CandidatesPayload = { candidates: [] }

export function CandidatesView() {
  const [data, setData] = useState<CandidatesPayload | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState<'all' | Stage>('all')
  const [view, setView] = useState<ViewMode>('grid')
  const [addOpen, setAddOpen] = useState(false)
  const [csvOpen, setCsvOpen] = useState(false)
  const [hiringRequests, setHiringRequests] = useState<{ id: string; title: string }[]>([])
  // Sprint 17 — bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkPending, setBulkPending] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [savedViewsOpen, setSavedViewsOpen] = useState(false)

  useEffect(() => {
    startTransition(async () => {
      try {
        setData(await getCandidatesAction())
      } catch (err) {
        console.error('[candidates] failed to load data', err)
        setData(EMPTY)
      }
    })
  }, [refreshKey])

  // Load hiring requests for the CSV import picker
  useEffect(() => {
    let cancelled = false
    import('../actions').then(async ({ getHiringRequestsForSelectAction }) => {
      const r = await getHiringRequestsForSelectAction()
      if (cancelled) return
      // The action returns { ok, requests: [...] } — unwrap it
      const list = (r && Array.isArray((r as { requests?: unknown[] }).requests))
        ? (r as { requests: { id: string; title: string }[] }).requests
        : Array.isArray(r)
          ? (r as { id: string; title: string }[])
          : []
      setHiringRequests(list)
    }).catch(() => null)
    return () => { cancelled = true }
  }, [])

  // Sprint 17 — bulk move
  async function bulkMove(toStage: 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'REJECTED' | 'HIRED') {
    if (selected.size === 0) return
    if (selected.size > 100) {
      setBulkError('Maximum 100 candidates per bulk action.')
      return
    }
    setBulkPending(true)
    setBulkError(null)
    try {
      const { bulkMoveCandidatesAction } = await import('@/app/(app)/hiring-requests/[id]/candidates/actions')
      const r = await bulkMoveCandidatesAction({
        candidateIds: Array.from(selected),
        toStage: toStage as never,
      })
      if (!r.ok) {
        setBulkError(r.error.message)
        return
      }
      setSelected(new Set())
      setRefreshKey(k => k + 1)
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Bulk action failed.')
    } finally {
      setBulkPending(false)
    }
  }

  const filtered = useMemo(() => {
    if (!data) return []
    return data.candidates.filter(c => {
      if (stage !== 'all' && c.stage !== stage) return false
      if (
        search &&
        !`${c.name} ${c.email} ${c.position}`.toLowerCase().includes(search.toLowerCase())
      ) {
        return false
      }
      return true
    })
  }, [data, search, stage])

  if (!data) {
    return (
      <div className="space-y-8 p-8">
        <PageHeader title="Candidates" description="Loading candidates…" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Candidates"
        description="Every person in your hiring pipeline — searchable, filterable, and ready to move forward. Click a candidate to open their full profile."
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {data.candidates.length} active
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setSavedViewsOpen(true)}
              aria-haspopup="dialog"
            >
              <FilterIcon className="h-4 w-4" aria-hidden />
              Saved views
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <UserPlusIcon className="h-4 w-4" aria-hidden />
              Add candidate
            </Button>
            <Button variant="outline" onClick={() => setCsvOpen(true)}>
              <UploadIcon className="h-4 w-4" aria-hidden />
              Import CSV
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="space-y-5 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1 lg:max-w-md">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, email, or role…"
                aria-label="Search candidates"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Filter by stage" className="flex gap-1.5">
                {STAGE_FILTERS.map(s => {
                  const active = s.id === stage
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStage(s.id)}
                      aria-pressed={active}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40',
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

              <div
                role="group"
                aria-label="View as"
                className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800"
              >
                <button
                  type="button"
                  onClick={() => setView('grid')}
                  aria-pressed={view === 'grid'}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40',
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
                  aria-pressed={view === 'list'}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40',
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
            {filtered.length} of {data.candidates.length} candidates
          </div>

          {filtered.length > 0 ? (
            view === 'grid' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filtered.map(c => (
                  <CandidateCard key={c.id} candidate={c} />
                ))}
              </div>
            ) : (
              <>
              {selected.size > 0 && (
                <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/40">
                  <div className="flex items-center gap-2 text-sm text-emerald-900 dark:text-emerald-200">
                    <strong>{selected.size}</strong> selected
                    <button
                      type="button"
                      onClick={() => setSelected(new Set())}
                      className="ml-2 text-emerald-700 hover:underline dark:text-emerald-300"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      disabled={bulkPending}
                      onChange={async (e) => {
                        const to = e.target.value
                        if (!to) return
                        await bulkMove(to as 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'REJECTED' | 'HIRED')
                        e.currentTarget.value = ''
                      }}
                      className="h-8 rounded border border-emerald-300 bg-white px-2 text-xs dark:border-emerald-800 dark:bg-slate-800 dark:text-slate-100"
                      defaultValue=""
                    >
                      <option value="" disabled>Move to…</option>
                      <option value="SCREENING">Screening</option>
                      <option value="INTERVIEW">Interview</option>
                      <option value="OFFER">Offer</option>
                      <option value="REJECTED">Rejected</option>
                      <option value="HIRED">Hired</option>
                    </select>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={bulkPending}>
                      <XIcon className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
              {bulkError && (
                <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
                  {bulkError}
                </div>
              )}
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                    <tr>
                      <th className="w-10 px-3 py-3 text-left">
                        <input
                          type="checkbox"
                          aria-label="Select all visible candidates"
                          checked={filtered.length > 0 && filtered.every(c => selected.has(c.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelected(new Set([...selected, ...filtered.map(c => c.id)]))
                            } else {
                              const next = new Set(selected)
                              filtered.forEach(c => next.delete(c.id))
                              setSelected(next)
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                        />
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">Candidate</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">Role</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">Stage</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">Rating</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">Applied</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filtered.map(c => (
                      <tr key={c.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50">
                        <td className="w-10 px-3 py-3 align-top">
                          <input
                            type="checkbox"
                            aria-label={`Select ${c.name}`}
                            checked={selected.has(c.id)}
                            onChange={(e) => {
                              const next = new Set(selected)
                              if (e.target.checked) next.add(c.id)
                              else next.delete(c.id)
                              setSelected(next)
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/candidates/${c.id}`} className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-base">
                              {c.avatar}
                            </div>
                            <div>
                              <p className="font-medium text-slate-900 hover:text-emerald-600 dark:text-slate-50 dark:hover:text-emerald-400">
                                {c.name}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">{c.email}</p>
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{c.position}</td>
                        <td className="px-4 py-3">
                          <StatusBadge stage={c.stage} />
                        </td>
                        <td className="px-4 py-3">
                          <RatingStars rating={c.rating} />
                        </td>
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                          {new Date(c.appliedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
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

      <AddCandidateModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => setRefreshKey(k => k + 1)}
      />

      <ImportCsvModal
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        hiringRequests={hiringRequests}
        onImported={() => setRefreshKey(k => k + 1)}
      />

      <SavedViewsDialog
        open={savedViewsOpen}
        onClose={() => setSavedViewsOpen(false)}
      />
    </div>
  )
}

function SavedViewsDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  // Escape to close + body-scroll lock.
  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = original
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="saved-views-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-950/40">
            <FilterIcon className="h-5 w-5 text-amber-600 dark:text-amber-300" aria-hidden />
          </div>
          <div className="flex-1">
            <h2
              id="saved-views-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-50"
            >
              Saved views — coming soon
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Save your current filters (stage, search) as a named view you can
              switch back to later. The persistence layer is not built yet;
              until then, use the search and stage filters at the top of this
              page to narrow your list.
            </p>
            <div className="mt-4 flex justify-end">
              <Button onClick={onClose}>Got it</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CandidateCard({ candidate }: { candidate: CandidatesPayload['candidates'][number] }) {
  return (
    <Link
      href={`/candidates/${candidate.id}`}
      className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-2xl">
          {candidate.avatar}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900 group-hover:text-emerald-600 dark:text-slate-50 dark:group-hover:text-emerald-400">
            {candidate.name}
          </h3>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{candidate.position}</p>
          <div className="mt-2 flex items-center gap-1.5">
            <StatusBadge stage={candidate.stage} />
            <RatingStars rating={candidate.rating} compact />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-700/50 dark:text-slate-400">
        <MailIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{candidate.email}</span>
      </div>
    </Link>
  )
}

function RatingStars({ rating, compact = false }: { rating: number; compact?: boolean }) {
  const size = compact ? 'h-3 w-3' : 'h-3.5 w-3.5'
  return (
    <div className="flex items-center gap-0.5 text-amber-500">
      {Array.from({ length: 5 }).map((_, i) => (
        <StarIcon
          key={i}
          aria-hidden
          className={cn(size, i < rating ? 'fill-current' : 'opacity-30')}
        />
      ))}
    </div>
  )
}
