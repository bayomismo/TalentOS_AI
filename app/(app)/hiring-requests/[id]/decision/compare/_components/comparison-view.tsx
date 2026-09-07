'use client'

/**
 * Sprint 8 — Comparison view.
 *
 * Side-by-side, 2-4 finalists. AI CV match and human interview score are
 * visually and logically separate. NO combined final score. NO AI winner.
 */

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  Loader2Icon,
  RefreshCwIcon,
  SparklesIcon,
} from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/features/shared/components/status-badge'
import {
  type ComparisonView as ComparisonViewType,
} from '@/features/decisions/types'
import {
  getComparisonAction,
  generateDecisionBriefAction,
} from '@/features/decisions/actions/get-decision-hub'
import { cn } from '@/lib/utils'

interface Props {
  hiringRequestId: string
  candidateIds: string[]
}

export function ComparisonView({ hiringRequestId, candidateIds }: Props) {
  const [data, setData] = useState<ComparisonViewType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const r = await getComparisonAction(hiringRequestId, candidateIds)
    if (r.ok) setData(r.data)
    else setError(r.error.message)
    setLoading(false)
  }, [hiringRequestId, candidateIds])

  useEffect(() => { void load() }, [load])

  const onGenerateBrief = useCallback(async () => {
    setGenerating(true)
    const r = await generateDecisionBriefAction({ hiringRequestId, candidateIds })
    setGenerating(false)
    if (r.ok) {
      setToast({ kind: 'ok', msg: 'AI Decision Brief generated. Reload to view it.' })
      await load()
    } else {
      setToast({ kind: 'err', msg: r.error.message })
    }
    setTimeout(() => setToast(null), 4000)
  }, [hiringRequestId, candidateIds, load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2Icon className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-700">
            {error ?? 'Failed to load comparison.'}
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={() => void load()}>
                <RefreshCwIcon className="mr-1 h-4 w-4" /> Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Side-by-side comparison"
        description={`${data.candidates.length} finalists. AI is decision-support only — the final decision is yours.`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.location.href = `/hiring-requests/${hiringRequestId}/decision`}>
              <ArrowLeftIcon className="mr-1 h-4 w-4" /> Back to Hub
            </Button>
            <Button size="sm" onClick={() => void onGenerateBrief()} disabled={generating}>
              {generating ? (
                <Loader2Icon className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <SparklesIcon className="mr-1 h-4 w-4" />
              )}
              {data.brief ? 'Regenerate' : 'Generate'} AI Brief
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Finalist grid</CardTitle>
          <CardDescription>
            AI CV match and human interview score are kept separate.
            There is no combined final score — only your decision.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className={cn(
            'grid gap-3',
            data.candidates.length === 2 && 'sm:grid-cols-2',
            data.candidates.length === 3 && 'sm:grid-cols-3',
            data.candidates.length === 4 && 'sm:grid-cols-2 lg:grid-cols-4',
          )}>
            {data.candidates.map(c => (
              <div key={c.id} className="rounded border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Link
                    href={`/candidates/${c.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {c.fullName}
                  </Link>
                  <StatusBadge stage={c.stage} />
                </div>
                <p className="text-xs text-slate-500">{c.currentTitle ?? '—'}</p>

                <div className="mt-3 space-y-2">
                  <ScoreBlock
                    label="AI CV Match"
                    sublabel="From AI CV analysis"
                    value={c.matchScore}
                    color="violet"
                  />
                  <ScoreBlock
                    label="Human Interview"
                    sublabel="From structured scorecard"
                    value={c.latestInterview?.interviewScore ?? null}
                    recommendation={c.latestInterview?.recommendation ?? null}
                    color="blue"
                  />
                </div>

                {c.topSkills.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-semibold uppercase text-slate-500">Top skills</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.topSkills.slice(0, 6).map(s => (
                        <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {c.latestInterview && (
                  <div className="mt-3 space-y-1 text-xs text-slate-600">
                    {c.latestInterview.strengths && (
                      <p>
                        <strong className="text-green-700">Strengths:</strong>{' '}
                        {c.latestInterview.strengths}
                      </p>
                    )}
                    {c.latestInterview.concerns && (
                      <p>
                        <strong className="text-amber-700">Concerns:</strong>{' '}
                        {c.latestInterview.concerns}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* AI Decision Brief */}
      {data.brief && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SparklesIcon className="h-4 w-4 text-violet-500" />
              AI Decision Brief
            </CardTitle>
            <CardDescription>
              Generated {new Date(data.brief.createdAt).toLocaleString()} · {data.brief.modelUsed}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-700">
              {data.brief.output.executiveSummary}
            </p>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Per-candidate evidence</p>
              {data.brief.output.candidates.map((c, i) => (
                <div key={i} className="rounded border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-medium text-slate-900">{c.candidateName}</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <EvidenceList title="Supporting evidence" items={c.evidenceSupportingCandidacy} color="green" />
                    <EvidenceList title="Areas requiring consideration" items={c.areasRequiringConsideration} color="amber" />
                  </div>
                </div>
              ))}
            </div>

            {data.brief.output.crossCandidateComparison.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Cross-candidate comparison</p>
                <ul className="mt-1 space-y-1">
                  {data.brief.output.crossCandidateComparison.map((p, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      <strong>{p.candidateA}</strong> vs <strong>{p.candidateB}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.brief.output.openQuestionsBeforeDecision.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Open questions before deciding</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {data.brief.output.openQuestionsBeforeDecision.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.brief.output.missingEvidence.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Missing evidence to gather</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {data.brief.output.missingEvidence.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.brief.output.recommendedNextSteps.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Recommended next steps</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {data.brief.output.recommendedNextSteps.map((s, i) => (
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

      {toast && (
        <div
          className={cn(
            'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded px-4 py-2 text-sm shadow-lg',
            toast.kind === 'ok' ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
          )}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function ScoreBlock({
  label,
  sublabel,
  value,
  recommendation,
  color,
}: {
  label: string
  sublabel: string
  value: number | null
  recommendation?: string | null
  color: 'violet' | 'blue'
}) {
  return (
    <div className={cn(
      'rounded border p-2',
      color === 'violet' ? 'border-violet-200 bg-violet-50' : 'border-blue-200 bg-blue-50',
    )}>
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase text-slate-600">{label}</p>
        <p className="text-xl font-semibold text-slate-900">
          {value !== null ? value : <span className="text-slate-400">—</span>}
        </p>
      </div>
      <p className="text-[10px] text-slate-500">{sublabel}</p>
      {recommendation && (
        <p className="mt-1 text-[10px] text-slate-600">
          Recommendation: {recommendation.toLowerCase().replace('_', ' ')}
        </p>
      )}
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
