'use client'

/**
 * Sprint 6 — AI Candidate Workspace view.
 *
 * Drag-and-drop upload, live queue (per-file status), ranked candidate
 * list with filters and sort, and stage-move actions.
 */

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  FileTextIcon,
  FilterIcon,
  Loader2Icon,
  MicIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  TrashIcon,
  UploadIcon,
  UserPlusIcon,
  XIcon,
} from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/features/shared/components/status-badge'
import { getEventBus } from '@/lib/events'
import {
  getCandidateWorkspaceAction,
  uploadCVsAction,
  moveCandidateStageAction,
  reanalyzeCandidateAction,
  type WorkspacePayload,
  type WorkspaceCandidate,
  type UploadedCVResult,
} from '../actions'
import { cn } from '@/lib/utils'
import type { ApplicationStage } from '@prisma/client'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type QueueStatus = 'queued' | 'uploading' | 'parsing' | 'analyzing' | 'completed' | 'failed'

interface QueueItem {
  clientId: string
  file: File
  fileName: string
  fileSize: number
  fileKind: 'PDF' | 'DOCX'
  status: QueueStatus
  progressMessage: string
  errorMessage?: string
  candidate?: WorkspaceCandidate
}

const ACCEPTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const ACCEPTED_EXT = ['.pdf', '.docx']

const STAGE_FILTERS: { id: 'all' | ApplicationStage; label: string }[] = [
  { id: 'all', label: 'All stages' },
  { id: 'APPLIED', label: 'Applied' },
  { id: 'SCREENING', label: 'Screening' },
  { id: 'INTERVIEW', label: 'Interview' },
  { id: 'OFFER', label: 'Offer' },
  { id: 'HIRED', label: 'Hired' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'WITHDRAWN', label: 'Withdrawn' },
]

const RECOMMENDATION_FILTERS = [
  'all',
  'Strong Match',
  'Good Match',
  'Potential Match',
  'Weak Match',
  'Not Recommended',
] as const

type SortKey = 'score' | 'experience' | 'name' | 'applied'
const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'score', label: 'Match score' },
  { id: 'experience', label: 'Experience' },
  { id: 'name', label: 'Name' },
  { id: 'applied', label: 'Upload date' },
]

// -----------------------------------------------------------------------------
// Main view
// -----------------------------------------------------------------------------

export function WorkspaceView({ hiringRequestId }: { hiringRequestId: string }) {
  const [data, setData] = useState<WorkspacePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [queue, setQueue] = useState<QueueItem[]>([])
  const queueRef = useRef<QueueItem[]>([])
  queueRef.current = queue

  const loadData = useCallback(() => {
    startTransition(async () => {
      const r = await getCandidateWorkspaceAction(hiringRequestId)
      if (r.ok) {
        setData(r.data)
        setError(null)
      } else {
        setError(r.error.message)
      }
    })
  }, [hiringRequestId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Event bus: live updates from server actions
  useEffect(() => {
    const bus = getEventBus()
    const offs: Array<() => void> = []

    offs.push(
      bus.subscribe('CandidateCreated', e => {
        if (e.payload.hiringRequestId !== hiringRequestId) return
        setData(prev =>
          prev
            ? {
                ...prev,
                candidates: [
                  {
                    id: e.payload.id,
                    fullName: e.payload.fullName,
                    email: e.payload.email,
                    currentTitle: e.payload.currentTitle,
                    yearsExperience: e.payload.yearsExperience,
                    topSkills: [],
                    stage: 'APPLIED',
                    rating: 0,
                    matchScore: null,
                    recommendation: null,
                    recommendationReasoning: null,
                    strengths: [],
                    gaps: [],
                    concerns: [],
                    appliedAt: e.payload.createdAt,
                    analyzedAt: null,
                    avatar: '👤',
                    source: 'CV Upload',
                  },
                  ...prev.candidates,
                ],
                stats: { ...prev.stats, total: prev.stats.total + 1 },
              }
            : prev
        )
      })
    )

    offs.push(
      bus.subscribe('CandidateAnalyzed', e => {
        if (e.payload.hiringRequestId !== hiringRequestId) return
        setData(prev => {
          if (!prev) return prev
          const candidates = prev.candidates.map(c =>
            c.id === e.payload.candidateId
              ? {
                  ...c,
                  matchScore: e.payload.analysis.overallScore,
                  recommendation: e.payload.analysis.recommendationLabel,
                  recommendationReasoning: e.payload.analysis.reasoning,
                  strengths: e.payload.analysis.strengths,
                  gaps: e.payload.analysis.gaps,
                  concerns: e.payload.analysis.concerns,
                  analyzedAt: e.payload.analysis.analyzedAt,
                }
              : c
          )
          // Re-sort by score desc
          candidates.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1))
          const analyzed = candidates.filter(c => c.matchScore !== null).length
          const avg =
            analyzed > 0
              ? Math.round(
                  candidates.reduce((s, c) => s + (c.matchScore ?? 0), 0) / analyzed
                )
              : null
          return { ...prev, candidates, stats: { ...prev.stats, analyzed, averageMatchScore: avg } }
        })
      })
    )

    offs.push(
      bus.subscribe('CandidateStageChanged', e => {
        if (e.payload.hiringRequestId !== hiringRequestId) return
        setData(prev => {
          if (!prev) return prev
          const candidates = prev.candidates.map(c =>
            c.id === e.payload.candidateId
              ? { ...c, stage: e.payload.toStage }
              : c
          )
          const shortlisted = candidates.filter(
            c => c.stage === 'SCREENING' || c.stage === 'INTERVIEW' || c.stage === 'OFFER' || c.stage === 'HIRED'
          ).length
          return { ...prev, candidates, stats: { ...prev.stats, shortlisted } }
        })
      })
    )

    return () => offs.forEach(off => off())
  }, [hiringRequestId])

  // ---------------------------------------------------------------------
  // File handling
  // ---------------------------------------------------------------------

  const enqueueFiles = useCallback((files: File[]) => {
    if (files.length === 0) return
    const newItems: QueueItem[] = files.map(f => {
      const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase()
      const fileKind: 'PDF' | 'DOCX' = ext === '.pdf' ? 'PDF' : 'DOCX'
      return {
        clientId: crypto.randomUUID(),
        file: f,
        fileName: f.name,
        fileSize: f.size,
        fileKind,
        status: 'queued',
        progressMessage: 'Queued',
      }
    })
    setQueue(prev => [...newItems, ...prev])
  }, [])

  const removeQueueItem = useCallback((clientId: string) => {
    setQueue(prev => prev.filter(q => q.clientId !== clientId))
  }, [])

  const clearCompleted = useCallback(() => {
    setQueue(prev => prev.filter(q => q.status !== 'completed'))
  }, [])

  // Process the queue: process one file at a time to avoid Vercel
  // function timeouts on large batches.
  useEffect(() => {
    const next = queueRef.current.find(q => q.status === 'queued')
    if (!next) return
    processQueueItem(next)
  }, [queue])

  async function processQueueItem(item: QueueItem) {
    const update = (patch: Partial<QueueItem>) =>
      setQueue(prev => prev.map(q => (q.clientId === item.clientId ? { ...q, ...patch } : q)))

    try {
      update({ status: 'uploading', progressMessage: 'Uploading…' })
      const base64 = await readFileAsBase64(item.file)

      update({ status: 'parsing', progressMessage: 'Extracting text…' })
      // Actual parsing happens server-side, but we mark this client-side
      // so the user sees progress.

      update({ status: 'analyzing', progressMessage: 'AI is analyzing this CV…' })

      const result = await uploadCVsAction({
        hiringRequestId,
        files: [
          {
            clientId: item.clientId,
            fileName: item.fileName,
            mimeType: item.file.type || `${item.fileKind.toLowerCase()}/...`,
            base64,
          },
        ],
      })

      if (!result.ok) {
        update({
          status: 'failed',
          errorMessage: result.error.message,
          progressMessage: 'Failed',
        })
        return
      }

      const uploadResult = result.data.results[0]
      if (!uploadResult) {
        update({ status: 'failed', errorMessage: 'No result returned', progressMessage: 'Failed' })
        return
      }
      if (uploadResult.error) {
        update({
          status: 'failed',
          errorMessage: uploadResult.error.message,
          progressMessage: 'Failed',
        })
        return
      }

      update({
        status: 'completed',
        progressMessage: 'Done',
        candidate: uploadResult.candidate ?? undefined,
      })

      // Reload the workspace data (which will re-sort by score)
      loadData()
    } catch (err) {
      update({
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : 'Unexpected error',
        progressMessage: 'Failed',
      })
    }
  }

  // ---------------------------------------------------------------------
  // Filters / sort
  // ---------------------------------------------------------------------

  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<'all' | ApplicationStage>('all')
  const [recFilter, setRecFilter] = useState<(typeof RECOMMENDATION_FILTERS)[number]>('all')
  const [minScore, setMinScore] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('score')

  const filteredCandidates = useMemo(() => {
    if (!data) return []
    const filtered = data.candidates.filter(c => {
      if (stageFilter !== 'all' && c.stage !== stageFilter) return false
      if (recFilter !== 'all' && c.recommendation !== recFilter) return false
      if (minScore > 0 && (c.matchScore ?? 0) < minScore) return false
      if (search) {
        const q = search.toLowerCase()
        const haystack = `${c.fullName} ${c.email} ${c.currentTitle ?? ''} ${c.topSkills.join(' ')}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
    const sorted = [...filtered]
    switch (sortKey) {
      case 'score':
        sorted.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1))
        break
      case 'experience':
        sorted.sort((a, b) => (b.yearsExperience ?? 0) - (a.yearsExperience ?? 0))
        break
      case 'name':
        sorted.sort((a, b) => a.fullName.localeCompare(b.fullName))
        break
      case 'applied':
        sorted.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())
        break
    }
    return sorted
  }, [data, search, stageFilter, recFilter, minScore, sortKey])

  // ---------------------------------------------------------------------
  // Stage actions
  // ---------------------------------------------------------------------

  async function changeStage(candidateId: string, toStage: ApplicationStage) {
    const r = await moveCandidateStageAction({ candidateId, toStage })
    if (!r.ok) {
      console.error('[workspace] move stage failed:', r.error)
    }
  }

  async function reanalyze(candidateId: string) {
    const r = await reanalyzeCandidateAction(candidateId)
    if (!r.ok) {
      console.error('[workspace] reanalyze failed:', r.error)
    } else {
      loadData()
    }
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  if (error) {
    return (
      <div className="space-y-8 p-8">
        <BackLink />
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-base font-semibold text-slate-900 dark:text-slate-50">
              {error}
            </p>
            <Button className="mt-5" onClick={loadData}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-8 p-8">
        <BackLink />
        <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800" />
        <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800" />
      </div>
    )
  }


  const jd = data.jobDescription

  return (
    <div className="space-y-8 p-8">
      <BackLink jobTitle={data.hiringRequest.title} />

      <PageHeader
        title={data.hiringRequest.title}
        description="Upload candidate CVs. TalentOS AI will parse, analyze, score, and rank them against the job description."
        actions={
          <Button>
            <Link href={`/hiring-requests`}>All hiring requests</Link>
          </Button>
        }
        meta={
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              {data.hiringRequest.department}
            </span>
            {data.hiringRequest.location && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                · {data.hiringRequest.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              · {data.hiringRequest.openings} opening{data.hiringRequest.openings === 1 ? '' : 's'}
            </span>
          </>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total candidates" value={data.stats.total} />
        <StatTile label="AI analyzed" value={data.stats.analyzed} accent="emerald" />
        <StatTile label="Shortlisted" value={data.stats.shortlisted} accent="sky" />
        <StatTile
          label="Average score"
          value={data.stats.averageMatchScore ?? '—'}
          accent={data.stats.averageMatchScore != null ? 'amber' : undefined}
        />
      </div>

      {/* Job description summary */}
      {jd ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-4 w-4 text-emerald-600" aria-hidden />
              <CardTitle>Job description</CardTitle>
            </div>
            <CardDescription>The role this workspace evaluates candidates against.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {jd.summary && (
              <p className="text-sm text-slate-700 dark:text-slate-200">{jd.summary}</p>
            )}
            {jd.requiredSkills.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Required skills
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {jd.requiredSkills.map(s => (
                    <span
                      key={s}
                      className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-amber-700 dark:text-amber-300">
            <strong>No job description on this hiring request.</strong> Generate one in the AI Recruiter wizard before uploading CVs.
          </CardContent>
        </Card>
      )}

      {/* Empty-state CTA — only when 0 candidates */}
      {jd && data.candidates.length === 0 && (
        <Card>
          <CardContent className="space-y-4 p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <UserPlusIcon className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-900 dark:text-slate-50">
                No candidates yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
                Drop CVs below — TalentOS AI will parse each file, score candidates against this role, and rank them automatically.
              </p>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              PDF or DOCX · up to 5 MB each · multiple files supported
            </p>
          </CardContent>
        </Card>
      )}

      {/* Upload zone + queue */}
      {jd && (
        <UploadZone
          queue={queue}
          onEnqueue={enqueueFiles}
          onRemove={removeQueueItem}
          onClearCompleted={clearCompleted}
        />
      )}

      {/* Filters + table */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1 lg:max-w-md">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, email, or skill…"
                aria-label="Search candidates"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SelectPill
                label="Stage"
                value={stageFilter === 'all' ? 'All' : stageFilter}
                options={STAGE_FILTERS.map(s => ({ label: s.label, value: s.id }))}
                onChange={v => setStageFilter(v as 'all' | ApplicationStage)}
              />
              <SelectPill
                label="AI"
                value={recFilter === 'all' ? 'All' : recFilter}
                options={RECOMMENDATION_FILTERS.map(r => ({
                  label: r === 'all' ? 'All recommendations' : r,
                  value: r,
                }))}
                onChange={v => setRecFilter(v as (typeof RECOMMENDATION_FILTERS)[number])}
              />
              <SelectPill
                label="Sort"
                value={SORT_OPTIONS.find(o => o.id === sortKey)?.label ?? 'Match score'}
                options={SORT_OPTIONS.map(o => ({ label: o.label, value: o.id }))}
                onChange={v => setSortKey(v as SortKey)}
              />
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800">
                <span className="text-slate-500">Min score</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={minScore}
                  onChange={e => setMinScore(parseInt(e.target.value, 10))}
                  aria-label="Minimum match score"
                  className="w-20"
                />
                <span className="w-7 text-right font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                  {minScore}
                </span>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400">
            Showing {filteredCandidates.length} of {data.candidates.length} candidates
          </div>

          {filteredCandidates.length > 0 ? (
            <CandidatesTable
              candidates={filteredCandidates}
              onMoveStage={changeStage}
              onReanalyze={reanalyze}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center dark:border-slate-700 dark:bg-slate-800/40">
              <FilterIcon className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-50">
                No candidates match these filters
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Try clearing the filters or uploading a CV.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

function Breadcrumb({ jobTitle }: { jobTitle?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
      <Link
        href="/hiring-requests"
        className="rounded transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:hover:text-slate-50"
      >
        Hiring Requests
      </Link>
      {jobTitle && (
        <>
          <span aria-hidden className="text-slate-300 dark:text-slate-600">/</span>
          <span className="max-w-[280px] truncate font-medium text-slate-700 dark:text-slate-200" title={jobTitle}>
            {jobTitle}
          </span>
        </>
      )}
      <span aria-hidden className="text-slate-300 dark:text-slate-600">/</span>
      <span className="font-semibold text-slate-900 dark:text-slate-50">Candidate Workspace</span>
    </nav>
  )
}

// Backwards-compatible alias for existing call sites.
function BackLink({ jobTitle }: { jobTitle?: string }) {
  return <Breadcrumb jobTitle={jobTitle} />
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: 'emerald' | 'sky' | 'amber'
}) {
  const accentClasses = {
    emerald: 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20',
    sky: 'border-sky-200 bg-sky-50/40 dark:border-sky-900 dark:bg-sky-950/20',
    amber: 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20',
  }[accent ?? 'emerald'] ?? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'

  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        accent
          ? accentClasses
          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
        {value}
      </p>
    </div>
  )
}

function SelectPill({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { label: string; value: string }[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}:</span>
        <span className="font-medium">{value}</span>
        <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="listbox"
            className="absolute right-0 z-20 mt-1.5 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
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

// -----------------------------------------------------------------------------
// Upload zone
// -----------------------------------------------------------------------------

function UploadZone({
  queue,
  onEnqueue,
  onRemove,
  onClearCompleted,
}: {
  queue: QueueItem[]
  onEnqueue: (files: File[]) => void
  onRemove: (clientId: string) => void
  onClearCompleted: () => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return
      const accepted: File[] = []
      for (const f of Array.from(fileList)) {
        const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase()
        if (ACCEPTED_EXT.includes(ext) || ACCEPTED_MIME.includes(f.type)) {
          accepted.push(f)
        }
      }
      if (accepted.length > 0) onEnqueue(accepted)
    },
    [onEnqueue]
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Upload CVs</CardTitle>
            <CardDescription>
              PDF or DOCX, up to 5 MB each. One failure doesn&apos;t block the batch.
            </CardDescription>
          </div>
          {queue.some(q => q.status === 'completed') && (
            <Button variant="outline" size="sm" onClick={onClearCompleted}>
              <TrashIcon className="h-3.5 w-3.5" aria-hidden />
              Clear completed
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <label
          onDragOver={e => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault()
            setDragOver(false)
            handleFiles(e.dataTransfer.files)
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragOver
              ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20'
              : 'border-slate-300 bg-slate-50/40 hover:border-emerald-400 hover:bg-emerald-50/20 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:bg-emerald-950/10'
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
            onChange={e => handleFiles(e.target.files)}
            className="sr-only"
            aria-label="Upload CV files"
          />
          <UploadIcon className="h-8 w-8 text-slate-400" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {dragOver ? 'Drop to upload' : 'Drag & drop CVs here'}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              or <span className="font-semibold text-emerald-600">browse files</span> — PDF, DOCX
            </p>
          </div>
        </label>

        {queue.length > 0 && (
          <ul className="space-y-2" aria-label="Upload queue">
            {queue.map(item => (
              <QueueRow key={item.clientId} item={item} onRemove={onRemove} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function QueueRow({ item, onRemove }: { item: QueueItem; onRemove: (id: string) => void }) {
  const statusToColor: Record<QueueStatus, { chip: string; icon: React.ReactNode; label: string }> = {
    queued: {
      chip: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
      icon: <FileTextIcon className="h-3.5 w-3.5" aria-hidden />,
      label: 'Queued',
    },
    uploading: {
      chip: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200',
      icon: <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden />,
      label: 'Uploading',
    },
    parsing: {
      chip: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200',
      icon: <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden />,
      label: 'Parsing',
    },
    analyzing: {
      chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
      icon: <SparklesIcon className="h-3.5 w-3.5" aria-hidden />,
      label: 'AI analyzing',
    },
    completed: {
      chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
      icon: <CheckCircle2Icon className="h-3.5 w-3.5" aria-hidden />,
      label: 'Done',
    },
    failed: {
      chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200',
      icon: <AlertCircleIcon className="h-3.5 w-3.5" aria-hidden />,
      label: 'Failed',
    },
  }
  const s = statusToColor[item.status]

  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-700/50">
        <FileTextIcon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
          {item.fileName}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{item.fileKind}</span>
          <span>·</span>
          <span>{(item.fileSize / 1024).toFixed(1)} KB</span>
          {item.status === 'failed' && item.errorMessage ? (
            <>
              <span>·</span>
              <span className="truncate text-rose-600 dark:text-rose-400" title={item.errorMessage}>
                {item.errorMessage}
              </span>
            </>
          ) : (
            item.candidate && (
              <>
                <span>·</span>
                <Link
                  href={`/candidates/${item.candidate.id}`}
                  className="text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  View candidate
                </Link>
              </>
            )
          )}
        </div>
      </div>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          s.chip
        )}
      >
        {s.icon}
        {s.label}
      </span>
      <button
        type="button"
        onClick={() => onRemove(item.clientId)}
        aria-label="Remove from queue"
        className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      >
        <XIcon className="h-4 w-4" aria-hidden />
      </button>
    </li>
  )
}

// -----------------------------------------------------------------------------
// Candidates table
// -----------------------------------------------------------------------------

function CandidatesTable({
  candidates,
  onMoveStage,
  onReanalyze,
}: {
  candidates: WorkspaceCandidate[]
  onMoveStage: (id: string, toStage: ApplicationStage) => void
  onReanalyze: (id: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">Candidate</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">Role / Experience</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">Top skills</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">Match</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">Recommendation</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-50">Stage</th>
            <th className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-50">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
          {candidates.map(c => (
            <CandidateRow
              key={c.id}
              candidate={c}
              onMoveStage={onMoveStage}
              onReanalyze={onReanalyze}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CandidateRow({
  candidate,
  onMoveStage,
  onReanalyze,
}: {
  candidate: WorkspaceCandidate
  onMoveStage: (id: string, toStage: ApplicationStage) => void
  onReanalyze: (id: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const score = candidate.matchScore
  const scoreColor = score === null
    ? 'text-slate-400'
    : score >= 80
      ? 'text-emerald-600 dark:text-emerald-400'
      : score >= 60
        ? 'text-sky-600 dark:text-sky-400'
        : score >= 40
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-rose-600 dark:text-rose-400'

  return (
    <tr className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50">
      <td className="px-4 py-3">
        <Link href={`/candidates/${candidate.id}`} className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/10 text-lg">
            {candidate.avatar}
          </div>
          <div>
            <p className="font-medium text-slate-900 hover:text-emerald-600 dark:text-slate-50 dark:hover:text-emerald-400">
              {candidate.fullName}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{candidate.email}</p>
          </div>
        </Link>
      </td>
      <td className="px-4 py-3">
        <p className="text-slate-900 dark:text-slate-50">{candidate.currentTitle ?? '—'}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {candidate.yearsExperience != null
            ? `${candidate.yearsExperience} ${candidate.yearsExperience === 1 ? 'yr' : 'yrs'} experience`
            : '—'}
        </p>
      </td>
      <td className="px-4 py-3">
        <div className="flex max-w-[180px] flex-wrap gap-1">
          {candidate.topSkills.slice(0, 3).map(s => (
            <span
              key={s}
              className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 dark:bg-slate-700 dark:text-slate-200"
            >
              {s}
            </span>
          ))}
          {candidate.topSkills.length > 3 && (
            <span className="text-[11px] text-slate-400">+{candidate.topSkills.length - 3}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {score !== null ? (
          <div className="flex items-center gap-2">
            <span className={cn('text-base font-bold tabular-nums', scoreColor)}>{score}</span>
            <span className="text-xs text-slate-400">/100</span>
          </div>
        ) : (
          <span className="text-xs italic text-slate-400">Not analyzed</span>
        )}
      </td>
      <td className="px-4 py-3">
        {candidate.recommendation ? (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              recommendationPillClass(candidate.recommendation)
            )}
          >
            {candidate.recommendation}
          </span>
        ) : (
          <span className="text-xs italic text-slate-400">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusBadge stage={candidate.stage.toLowerCase() as 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn'} />
      </td>
      <td className="px-4 py-3">
        <div className="relative flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReanalyze(candidate.id)}
            aria-label={`Re-analyze ${candidate.fullName}`}
            title="Re-run AI analysis"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden />
          </Button>
          {(candidate.stage === 'SCREENING' || candidate.stage === 'INTERVIEW') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = `/candidates/${candidate.id}/interview-kit`
              }}
              aria-label={`Generate interview kit for ${candidate.fullName}`}
              title="Generate / open interview kit"
              className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
            >
              <MicIcon className="h-3.5 w-3.5" aria-hidden />
              <span className="ml-1.5">Interview Kit</span>
            </Button>
          )}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMenuOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              Move stage
              <ChevronDownIcon className="h-3 w-3" aria-hidden />
            </Button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-1.5 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
                >
                  <StageMenuItem
                    onClick={() => {
                      onMoveStage(candidate.id, 'SCREENING')
                      setMenuOpen(false)
                    }}
                    label="Shortlist → Screening"
                    current={candidate.stage === 'SCREENING'}
                  />
                  <StageMenuItem
                    onClick={() => {
                      onMoveStage(candidate.id, 'INTERVIEW')
                      setMenuOpen(false)
                    }}
                    label="Move to Interview"
                    current={candidate.stage === 'INTERVIEW'}
                  />
                  <StageMenuItem
                    onClick={() => {
                      onMoveStage(candidate.id, 'OFFER')
                      setMenuOpen(false)
                    }}
                    label="Move to Offer"
                    current={candidate.stage === 'OFFER'}
                  />
                  <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                  <StageMenuItem
                    onClick={() => {
                      onMoveStage(candidate.id, 'REJECTED')
                      setMenuOpen(false)
                    }}
                    label="Reject"
                    current={candidate.stage === 'REJECTED'}
                    tone="rose"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

function StageMenuItem({
  onClick,
  label,
  current,
  tone,
}: {
  onClick: () => void
  label: string
  current?: boolean
  tone?: 'rose'
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors',
        tone === 'rose'
          ? 'text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30'
          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50'
      )}
    >
      {label}
      {current && <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-500" aria-hidden />}
    </button>
  )
}

function recommendationPillClass(rec: string) {
  switch (rec) {
    case 'Strong Match':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200'
    case 'Good Match':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200'
    case 'Potential Match':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
    case 'Weak Match':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200'
    case 'Not Recommended':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200'
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        // result is "data:...;base64,...."
        const idx = result.indexOf(',')
        resolve(idx >= 0 ? result.slice(idx + 1) : result)
      } else {
        reject(new Error('FileReader returned non-string'))
      }
    }
    reader.readAsDataURL(file)
  })
}
