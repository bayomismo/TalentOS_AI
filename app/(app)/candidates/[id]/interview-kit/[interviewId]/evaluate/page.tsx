'use client'

/**
 * Sprint 7 — Structured Evaluation form.
 *
 * The interviewer enters per-criterion scores (1-5) + free-form
 * strengths/concerns/notes, picks a recommendation, and submits. The
 * application computes the deterministic weighted interview score
 * (0-100) on submit.
 */

import Link from 'next/link'
import { use, useEffect, useMemo, useState, useTransition } from 'react'
import {
  ArrowLeftIcon,
  AlertCircleIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  FlagIcon,
  Loader2Icon,
  SendIcon,
  SparklesIcon,
  StarIcon,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { getInterviewKitAction, submitEvaluationAction, type InterviewKitView } from '../../actions'
import { cn } from '@/lib/utils'

const RECOMMENDATION_OPTIONS = [
  { value: 'STRONG_HIRE', label: 'Strong Hire', color: 'emerald' },
  { value: 'HIRE', label: 'Hire', color: 'sky' },
  { value: 'MIXED', label: 'Mixed', color: 'amber' },
  { value: 'NO_HIRE', label: 'No Hire', color: 'rose' },
  { value: 'STRONG_NO_HIRE', label: 'Strong No Hire', color: 'rose' },
] as const

type Recommendation = (typeof RECOMMENDATION_OPTIONS)[number]['value']

export default function EvaluateInterviewPage({
  params,
}: {
  params: Promise<{ id: string; interviewId: string }>
}) {
  const { id, interviewId } = use(params)
  const [kit, setKit] = useState<InterviewKitView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scores, setScores] = useState<Record<string, number>>({})
  const [strengths, setStrengths] = useState('')
  const [concerns, setConcerns] = useState('')
  const [notes, setNotes] = useState('')
  const [recommendation, setRecommendation] = useState<Recommendation>('HIRE')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<{ interviewScore: number; evaluationId: string } | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    startTransition(async () => {
      const r = await getInterviewKitAction(interviewId)
      if (cancelled) return
      if (!r.ok) {
        setError(r.error.message)
        setLoading(false)
        return
      }
      setKit(r.data)
      if (r.data.hasEvaluation) {
        setSubmitted({ interviewScore: r.data.interviewScore ?? 0, evaluationId: r.data.evaluationId ?? '' })
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [interviewId])

  const interviewScore = useMemo(() => {
    if (!kit) return null
    let total = 0
    for (const c of kit.scorecard) {
      const s = scores[c.name]
      if (s === undefined) return null
      total += (s / 5) * c.weight
    }
    return Math.round(total)
  }, [kit, scores])

  const allScored = useMemo(() => {
    if (!kit) return false
    return kit.scorecard.every(c => scores[c.name] !== undefined)
  }, [kit, scores])

  const handleSubmit = async () => {
    if (!kit) return
    setSubmitting(true)
    setError(null)
    const r = await submitEvaluationAction({
      interviewId: kit.interviewId,
      criterionScores: scores,
      strengths,
      concerns,
      overallNotes: notes,
      recommendation,
    })
    setSubmitting(false)
    if (!r.ok) {
      setError(r.error.message)
      return
    }
    setSubmitted({ interviewScore: r.data.interviewScore, evaluationId: r.data.evaluationId })
  }

  if (loading) {
    return (
      <div className="space-y-6 p-8">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800" />
      </div>
    )
  }

  if (!kit) {
    return (
      <div className="space-y-6 p-8">
        <Link href={`/candidates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeftIcon className="h-4 w-4" /> Back to candidate
        </Link>
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-base font-semibold text-slate-900 dark:text-slate-50">{error ?? 'Interview not found.'}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="space-y-8 p-8">
        <nav className="flex items-center gap-1.5 text-sm text-slate-500">
          <Link href="/candidates" className="hover:text-slate-900">Candidates</Link>
          <span>›</span>
          <Link href={`/candidates/${id}`} className="hover:text-slate-900">{kit.candidateName}</Link>
          <span>›</span>
          <Link href={`/candidates/${id}/interview-kit`} className="hover:text-slate-900">Interview Kit</Link>
          <span>›</span>
          <span className="font-medium text-slate-700">Evaluation</span>
        </nav>
        <Card>
          <CardContent className="space-y-6 p-12 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2Icon className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                Evaluation submitted
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Deterministic interview score: <strong className="text-emerald-700 dark:text-emerald-300">{submitted.interviewScore} / 100</strong>
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => {
                  window.location.href = `/candidates/${id}`
                }}
              >
                View candidate
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  window.location.href = `/candidates/${id}/interview-kit`
                }}
              >
                Back to interview kit
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  window.location.href = '/interview-center'
                }}
              >
                Interview Center
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-8 p-8">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
        <Link href="/candidates" className="hover:text-slate-900 dark:hover:text-slate-50">
          Candidates
        </Link>
        <span>›</span>
        <Link href={`/candidates/${id}`} className="hover:text-slate-900 dark:hover:text-slate-50">
          {kit.candidateName}
        </Link>
        <span>›</span>
        <Link href={`/candidates/${id}/interview-kit`} className="hover:text-slate-900 dark:hover:text-slate-50">
          Interview Kit
        </Link>
        <span>›</span>
        <span className="font-medium text-slate-700 dark:text-slate-200">Evaluation</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Evaluate — {kit.candidateName}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {kit.position} · {kit.interviewType.replace(/_/g, ' ')} · Round {kit.round}
          </p>
        </div>
        {interviewScore != null && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
            <div className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Live preview</div>
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
              {interviewScore} / 100
            </div>
          </div>
        )}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Scorecard</CardTitle>
          <CardDescription>
            Rate each criterion 1 (poor) to 5 (excellent). The interview score is
            calculated deterministically as <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">Σ (score / 5 × weight)</code>.
            Weights must total 100.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {kit.scorecard.map(c => (
            <div key={c.name} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                    {c.name}
                    <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                      weight {c.weight}%
                    </span>
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{c.description}</p>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setScores(prev => ({ ...prev, [c.name]: n }))}
                      aria-label={`Rate ${c.name} ${n} of 5`}
                      className={cn(
                        'h-9 w-9 rounded-md text-sm font-semibold transition',
                        scores[c.name] === n
                          ? 'bg-emerald-600 text-white shadow'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded bg-rose-50/60 p-2 text-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                  <div className="font-semibold">Poor (1)</div>
                  <div className="mt-0.5">{c.poorIndicator}</div>
                </div>
                <div className="rounded bg-emerald-50/60 p-2 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <div className="font-semibold">Excellent (5)</div>
                  <div className="mt-0.5">{c.excellentIndicator}</div>
                </div>
              </div>
            </div>
          ))}
          {!allScored && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>Rate every criterion before submitting.</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Free-form notes</CardTitle>
          <CardDescription>Help the next interviewer (and your future self) understand the call.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Strengths observed
            </label>
            <textarea
              value={strengths}
              onChange={e => setStrengths(e.target.value)}
              rows={5}
              placeholder="Specific things this candidate did well, with evidence."
              className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Concerns observed
            </label>
            <textarea
              value={concerns}
              onChange={e => setConcerns(e.target.value)}
              rows={5}
              placeholder="Gaps, red flags, or things that need follow-up."
              className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Overall notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
              placeholder="Summary of the interview, anything else worth recording."
              className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Final recommendation</CardTitle>
          <CardDescription>
            AI is decision support. The human decision-maker remains responsible for the call.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {RECOMMENDATION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRecommendation(opt.value)}
                className={cn(
                  'rounded-full border px-4 py-1.5 text-sm font-medium transition',
                  recommendation === opt.value
                    ? opt.color === 'emerald'
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : opt.color === 'sky'
                        ? 'border-sky-500 bg-sky-500 text-white'
                        : opt.color === 'amber'
                          ? 'border-amber-500 bg-amber-500 text-white'
                          : 'border-rose-500 bg-rose-500 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-md bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-6 dark:border-slate-700">
        <Button
          variant="outline"
          onClick={() => {
            window.location.href = `/candidates/${id}/interview-kit`
          }}
        >
          Cancel
        </Button>
        <Button
          className="bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={handleSubmit}
          disabled={submitting || !allScored}
        >
          {submitting ? (
            <>
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              Submitting…
            </>
          ) : (
            <>
              <SendIcon className="mr-2 h-4 w-4" />
              Submit evaluation
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
