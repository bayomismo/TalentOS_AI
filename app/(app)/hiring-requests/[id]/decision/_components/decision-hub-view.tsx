'use client'

/**
 * Sprint 8 — Decision Hub view.
 *
 * Deterministic readiness chips, finalist selection (2-4), comparison CTA,
 * decision evidence cards, recent activity feed. AI is decision-support only —
 * this view NEVER auto-selects/rejects/ranks-as-winner.
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import {
  ArrowLeftIcon,
  BriefcaseIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ClockIcon,
  Loader2Icon,
  RefreshCwIcon,
  SparklesIcon,
  UserCheckIcon,
  UserMinusIcon,
  UsersIcon,
  XCircleIcon,
} from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/features/shared/components/status-badge'
import {
  READINESS_COLOR,
  READINESS_LABEL,
  type DecisionHubView as DecisionHubViewType,
  type DecisionCandidateView,
  type DecisionReadiness,
} from '@/features/decisions/types'
import {
  getDecisionHubAction,
  generateDecisionBriefAction,
  recordDecisionAction,
} from '@/features/decisions/actions/get-decision-hub'
import { cn } from '@/lib/utils'

const READINESS_ICON: Record<DecisionReadiness, React.ElementType> = {
  NOT_READY: ClockIcon,
  NEEDS_INTERVIEW: ClockIcon,
  AWAITING_EVALUATION: ClockIcon,
  READY_FOR_REVIEW: CheckCircle2Icon,
}

const DECISION_LABEL: Record<'ADVANCE' | 'HOLD' | 'REJECT' | 'SELECTED', string> = {
  ADVANCE: 'Advanced',
  HOLD: 'On hold',
  REJECT: 'Rejected',
  SELECTED: 'Selected',
}

const DECISION_COLOR: Record<'ADVANCE' | 'HOLD' | 'REJECT' | 'SELECTED', string> = {
  ADVANCE: 'bg-blue-100 text-blue-800',
  HOLD: 'bg-yellow-100 text-yellow-800',
  REJECT: 'bg-red-100 text-red-800',
  SELECTED: 'bg-green-100 text-green-800',
}

interface Props {
  hiringRequestId: string
}

export function DecisionHubView({ hiringRequestId }: Props) {
  const [data, setData] = useState<DecisionHubViewType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generatingBriefFor, setGeneratingBriefFor] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [confirmDialog, setConfirmDialog] = useState<{
    candidateId: string
    candidateName: string
    decision: 'SELECTED' | 'REJECT'
  } | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const r = await getDecisionHubAction(hiringRequestId)
    if (r.ok) {
      setData(r.data)
      setSelectedIds(prev => {
        // keep previous selection if still valid, else reset
        const valid = r.data.candidates.map(c => c.id)
        const next = new Set<string>()
        prev.forEach(id => { if (valid.includes(id)) next.add(id) })
        return next
      })
    } else {
      setError(r.error.message)
    }
    setLoading(false)
  }, [hiringRequestId])

  useEffect(() => { void load() }, [load])

  const onToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 4) next.add(id)
      return next
    })
  }, [])

  const onCompare = useCallback(() => {
    if (selectedIds.size < 2) return
    const ids = Array.from(selectedIds).join(',')
    window.location.href = `/hiring-requests/${hiringRequestId}/decision/compare?ids=${ids}`
  }, [hiringRequestId, selectedIds])

  const onGenerateBrief = useCallback(async (candidateIds: string[]) => {
    if (candidateIds.length < 2) return
    setGenerating(true)
    const next = new Set(generatingBriefFor)
    candidateIds.forEach(id => next.add(id))
    setGeneratingBriefFor(next)
    const r = await generateDecisionBriefAction({ hiringRequestId, candidateIds })
    setGenerating(false)
    setGeneratingBriefFor(new Set())
    if (r.ok) {
      setToast({ kind: 'ok', msg: `AI Decision Brief generated for ${candidateIds.length} candidate(s)` })
      await load()
    } else {
      setToast({ kind: 'err', msg: r.error.message })
    }
    setTimeout(() => setToast(null), 4000)
  }, [generatingBriefFor, hiringRequestId, load])

  const onConfirmDecision = useCallback(async (notes: string) => {
    if (!confirmDialog) return
    setPendingId(confirmDialog.candidateId)
    startTransition(async () => {
      const r = await recordDecisionAction({
        candidateId: confirmDialog.candidateId,
        hiringRequestId,
        decision: confirmDialog.decision,
        notes: notes || undefined,
      })
      setPendingId(null)
      setConfirmDialog(null)
      if (r.ok) {
        setToast({ kind: 'ok', msg: `Candidate ${DECISION_LABEL[confirmDialog.decision].toLowerCase()}` })
        await load()
      } else {
        setToast({ kind: 'err', msg: r.error.message })
      }
      setTimeout(() => setToast(null), 4000)
    })
  }, [confirmDialog, hiringRequestId, load])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2Icon className="h-6 w-6 animate-spin text-slate-400" />
        <span className="ml-2 text-slate-500">Loading Decision Hub…</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle text={error ?? 'Unknown error'} onRetry={() => void load()} />
          </CardContent>
        </Card>
      </div>
    )
  }

  const { hiringRequest: hr, counts, candidates, recentActivities, latestBrief } = data
  const finalists = candidates.filter(c => c.readiness === 'READY_FOR_REVIEW')
  const canCompare = selectedIds.size >= 2 && selectedIds.size <= 4

  return (
    <div className="space-y-6">
      <PageHeader
        title="Decision Hub"
        description="Compare finalists, generate an AI Decision Brief, and record the human decision."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.location.href = `/hiring-requests/${hiringRequestId}/candidates`}>
              <ArrowLeftIcon className="mr-1 h-4 w-4" /> Workspace
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCwIcon className="mr-1 h-4 w-4" /> Refresh
            </Button>
          </div>
        }
      />

      {/* Position summary */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-xl">{hr.title}</CardTitle>
              <CardDescription>
                {hr.department ?? '—'} · Hiring Manager: {hr.hiringManagerName ?? 'Unassigned'} · Status: {hr.status}
              </CardDescription>
            </div>
            <div className="text-right text-sm text-slate-500">
              {counts.selected}/{hr.openings ?? 1} opening{(hr.openings ?? 1) === 1 ? '' : 's'} filled
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Total" value={counts.total} icon={UsersIcon} />
            <Stat label="Shortlisted" value={counts.shortlisted} />
            <Stat label="Interviewed" value={counts.interviewed} />
            <Stat label="Selected" value={counts.selected} accent="green" />
            <Stat label="Rejected" value={counts.rejected} accent="red" />
          </div>
        </CardContent>
      </Card>

      {/* Finalist selection toolbar */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <UserCheckIcon className="h-4 w-4" />
            <span>
              {selectedIds.size === 0
                ? 'Select 2–4 finalists to compare side-by-side.'
                : `${selectedIds.size} selected (max 4). ${selectedIds.size >= 2 ? 'Ready to compare.' : ''}`}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={selectedIds.size < 2 || generating}
              onClick={() => void onGenerateBrief(Array.from(selectedIds))}
            >
              {generating ? (
                <Loader2Icon className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <SparklesIcon className="mr-1 h-4 w-4" />
              )}
              Generate AI Brief
            </Button>
            <Button
              size="sm"
              disabled={!canCompare}
              onClick={onCompare}
            >
              Compare Selected
              <ChevronRightIcon className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Latest AI Decision Brief */}
      {latestBrief && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <SparklesIcon className="h-4 w-4 text-violet-500" />
                  Latest AI Decision Brief
                </CardTitle>
                <CardDescription>
                  {latestBrief.comparedCandidateIds.length} candidate(s) · {latestBrief.modelUsed} ·{' '}
                  {new Date(latestBrief.createdAt).toLocaleString()}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-700">
              {latestBrief.output.executiveSummary}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {latestBrief.output.candidates.map((c, i) => (
                <div key={i} className="rounded border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-medium text-slate-900">{c.candidateName}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <EvidenceList title="Supporting" items={c.evidenceSupportingCandidacy} color="green" />
                    <EvidenceList title="Considerations" items={c.areasRequiringConsideration} color="amber" />
                  </div>
                </div>
              ))}
            </div>
            {latestBrief.output.recommendedNextSteps.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Recommended next steps</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {latestBrief.output.recommendedNextSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs italic text-slate-500">
              AI is decision-support only. Every claim above is anchored to a specific source
              (CV, AI_CV_ANALYSIS, INTERVIEW_EVALUATION, INTERVIEWER_NOTES, or SCORECARD).
            </p>
          </CardContent>
        </Card>
      )}

      {/* Candidate list */}
      <Card>
        <CardHeader>
          <CardTitle>Candidates</CardTitle>
          <CardDescription>
            {finalists.length} ready for review · {candidates.length - finalists.length} pending evidence.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {candidates.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">
              No analyzed candidates yet. Upload CVs in the workspace first.
            </p>
          )}
          {candidates.map(c => (
            <CandidateRow
              key={c.id}
              candidate={c}
              isSelected={selectedIds.has(c.id)}
              onToggleSelect={() => onToggleSelect(c.id)}
              canSelectMore={selectedIds.size < 4}
              onSelectDecision={(d) =>
                setConfirmDialog({ candidateId: c.id, candidateName: c.fullName, decision: d })
              }
              pending={pendingId === c.id}
            />
          ))}
        </CardContent>
      </Card>

      {/* Recent activity */}
      {recentActivities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {recentActivities.map(a => (
                <li key={a.id} className="flex items-start gap-2">
                  <span className="mt-0.5 text-xs text-slate-400">
                    {new Date(a.occurredAt).toLocaleString()}
                  </span>
                  <span className="flex-1 text-slate-700">{a.title}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {confirmDialog && (
        <ConfirmDialog
          candidateName={confirmDialog.candidateName}
          decision={confirmDialog.decision}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={onConfirmDecision}
          busy={isPending}
        />
      )}

      {toast && (
        <Toast kind={toast.kind} message={toast.msg} onClose={() => setToast(null)} />
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Subcomponents
// -----------------------------------------------------------------------------

function Stat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string
  value: number
  icon?: React.ElementType
  accent?: 'green' | 'red'
}) {
  return (
    <div
      className={cn(
        'rounded border border-slate-200 bg-white p-3',
        accent === 'green' && 'border-green-200 bg-green-50',
        accent === 'red' && 'border-red-200 bg-red-50',
      )}
    >
      <div className="flex items-center gap-1 text-xs uppercase text-slate-500">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function EvidenceList({
  title,
  items,
  color,
}: {
  title: string
  items: Array<{ claim: string; source: string }>
  color: 'green' | 'amber'
}) {
  return (
    <div>
      <p className={cn(
        'text-[10px] font-semibold uppercase',
        color === 'green' ? 'text-green-700' : 'text-amber-700',
      )}>
        {title}
      </p>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-xs text-slate-700">
            <span>{it.claim}</span>
            <span className="ml-1 rounded bg-slate-200 px-1 text-[9px] text-slate-600">
              {it.source}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CandidateRow({
  candidate: c,
  isSelected,
  onToggleSelect,
  canSelectMore,
  onSelectDecision,
  pending,
}: {
  candidate: DecisionCandidateView
  isSelected: boolean
  onToggleSelect: () => void
  canSelectMore: boolean
  onSelectDecision: (d: 'SELECTED' | 'REJECT') => void
  pending: boolean
}) {
  const ReadinessIcon = READINESS_ICON[c.readiness]
  const disabled = !isSelected && !canSelectMore
  return (
    <div className={cn(
      'rounded border p-3 transition',
      isSelected ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-white',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <input
            type="checkbox"
            checked={isSelected}
            disabled={disabled}
            onChange={onToggleSelect}
            aria-label={`Select ${c.fullName}`}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500 disabled:opacity-40"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/candidates/${c.id}`}
                className="font-medium text-slate-900 hover:underline"
              >
                {c.fullName}
              </Link>
              <span className="text-xs text-slate-500">{c.currentTitle ?? '—'}</span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                  READINESS_COLOR[c.readiness],
                )}
                title={READINESS_LABEL[c.readiness]}
              >
                <ReadinessIcon className="h-3 w-3" />
                {READINESS_LABEL[c.readiness]}
              </span>
              <StatusBadge stage={c.stage} />
              {c.finalDecision && (
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium',
                    DECISION_COLOR[c.finalDecision.decision],
                  )}
                >
                  {DECISION_LABEL[c.finalDecision.decision]}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span>AI CV Match: <strong>{c.matchScore ?? '—'}</strong></span>
              {c.latestInterview && (
                <span>
                  Interview score: <strong>{c.latestInterview.interviewScore ?? '—'}</strong>
                  {c.latestInterview.recommendation && (
                    <span className="ml-1 text-slate-500">
                      ({c.latestInterview.recommendation.toLowerCase().replace('_', ' ')})
                    </span>
                  )}
                </span>
              )}
              {c.topSkills.slice(0, 4).map(s => (
                <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5">{s}</span>
              ))}
            </div>
            {c.finalDecision && (
              <p className="mt-1 text-xs text-slate-500">
                Decided by {c.finalDecision.decidedByName} on{' '}
                {new Date(c.finalDecision.decidedAt).toLocaleDateString()}
                {c.finalDecision.notes && ` — “${c.finalDecision.notes}”`}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {c.finalDecision === null && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSelectDecision('SELECTED')}
                disabled={pending}
                className="text-green-700 hover:bg-green-50"
              >
                {pending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <UserCheckIcon className="h-4 w-4" />}
                <span className="ml-1">Select</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSelectDecision('REJECT')}
                disabled={pending}
                className="text-red-700 hover:bg-red-50"
              >
                {pending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <UserMinusIcon className="h-4 w-4" />}
                <span className="ml-1">Reject</span>
              </Button>
            </>
          )}
          {c.finalDecision?.decision === 'SELECTED' && (
            <Button
              size="sm"
              variant="default"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => { window.location.href = `/candidates/${c.id}/offer` }}
            >
              <BriefcaseIcon className="mr-1 h-4 w-4" /> Create Offer
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function AlertTriangle({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <XCircleIcon className="mx-auto h-8 w-8 text-red-500" />
      <p className="text-sm text-slate-700">{text}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCwIcon className="mr-1 h-4 w-4" /> Retry
      </Button>
    </div>
  )
}

function ConfirmDialog({
  candidateName,
  decision,
  onCancel,
  onConfirm,
  busy,
}: {
  candidateName: string
  decision: 'SELECTED' | 'REJECT'
  onCancel: () => void
  onConfirm: (notes: string) => void
  busy: boolean
}) {
  const [notes, setNotes] = useState('')
  const isSelect = decision === 'SELECTED'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">
          {isSelect ? 'Mark as selected' : 'Reject candidate'}
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          {isSelect
            ? `This will record ${candidateName} as the final selection for this role.`
            : `This will record ${candidateName} as rejected for this role.`}
          {' '}The decision is final but can be updated later.
        </p>
        <textarea
          className="mt-3 w-full rounded border border-slate-300 p-2 text-sm"
          rows={3}
          placeholder="Reason / notes (optional but recommended)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => onConfirm(notes)}
            className={isSelect ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
          >
            {busy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : null}
            <span className="ml-1">
              {isSelect ? 'Confirm selection' : 'Confirm rejection'}
            </span>
          </Button>
        </div>
      </div>
    </div>
  )
}

function Toast({
  kind,
  message,
  onClose,
}: {
  kind: 'ok' | 'err'
  message: string
  onClose: () => void
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div
      className={cn(
        'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded px-4 py-2 text-sm shadow-lg',
        kind === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
      )}
    >
      {message}
    </div>
  )
}
