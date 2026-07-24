'use client'

/**
 * Sprint 18 — Single-interview kit viewer.
 *
 * The Interview Center "Open kit" button (and the candidate profile
 * "View interview" link) point to /candidates/<candidateId>/interview-kit/<interviewId>.
 * Until this page existed, those links hit a 404. This page re-uses the
 * same data source as the list page (`getInterviewKitAction`) but locks
 * the view to a specific interview, so the URL is shareable and the
 * back button doesn't lose context.
 *
 * The render mirrors the list page's "kit" panel but is scoped to
 * one interview. Code is intentionally duplicated (rather than a
 * shared component) because the list page has the interview switcher
 * + regenerate flow which aren't relevant here.
 */

import Link from 'next/link'
import { use, useEffect, useState, useTransition } from 'react'
import {
  ArrowLeftIcon,
  BrainIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ClipboardListIcon,
  ClockIcon,
  FileTextIcon,
  FlagIcon,
  ListChecksIcon,
  Loader2Icon,
  MicIcon,
  PlayCircleIcon,
  SparklesIcon,
  TargetIcon,
  TrendingUpIcon,
  UserIcon,
} from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import {
  getInterviewKitAction,
  type InterviewKitView,
} from '@/features/interviews/actions/get-interview-data'
import { cn } from '@/lib/utils'

// Shared with the list page so purpose labels and ordering stay consistent.
const PURPOSE_LABELS: Record<string, { label: string; color: string; description: string }> = {
  OPENING: {
    label: 'Opening questions',
    color: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800',
    description: 'Warm-up — establish rapport and a baseline.',
  },
  ROLE_SPECIFIC: {
    label: 'Role-specific',
    color: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800',
    description: 'Tied to the job responsibilities and required skills.',
  },
  SKILL_VALIDATION: {
    label: 'Skill validation',
    color: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-800',
    description: 'For skills the candidate claims AND the role requires.',
  },
  GAP_VALIDATION: {
    label: 'Gap validation',
    color: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800',
    description: 'Directly test the gaps identified in the AI match.',
  },
  CANDIDATE_SPECIFIC: {
    label: 'Candidate-specific',
    color: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-800',
    description: "Reference specific claims from the candidate's CV.",
  },
  BEHAVIORAL: {
    label: 'Behavioral',
    color: 'bg-pink-50 text-pink-700 ring-pink-200 dark:bg-pink-950/40 dark:text-pink-200 dark:ring-pink-800',
    description: 'STAR-style competency questions.',
  },
  SCENARIO: {
    label: 'Scenario / case',
    color: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-800',
    description: 'Realistic on-the-job scenario.',
  },
  CLOSING: {
    label: 'Closing',
    color: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
    description: "Candidate's questions + a final reflection.",
  },
}

const PURPOSE_ORDER = [
  'OPENING',
  'ROLE_SPECIFIC',
  'SKILL_VALIDATION',
  'GAP_VALIDATION',
  'CANDIDATE_SPECIFIC',
  'BEHAVIORAL',
  'SCENARIO',
  'CLOSING',
] as const

export default function InterviewKitDetailPage({
  params,
}: {
  params: Promise<{ id: string; interviewId: string }>
}) {
  const { id, interviewId } = use(params)
  const [kit, setKit] = useState<InterviewKitView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    startTransition(async () => {
      const r = await getInterviewKitAction(interviewId)
      if (cancelled) return
      if (!r.ok) {
        setError(r.error.message)
      } else {
        setKit(r.data)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [interviewId])

  if (loading) {
    return (
      <div className="space-y-6 p-8">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800" />
      </div>
    )
  }

  if (error || !kit) {
    return (
      <div className="space-y-6 p-8">
        <Link
          href={`/candidates/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to candidate
        </Link>
        <Card>
          <CardContent className="space-y-4 p-12 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
              <FileTextIcon className="h-7 w-7" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {error ? 'Could not load the interview kit' : 'No kit attached'}
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {error ?? 'This interview does not have a kit yet. Go back to the candidate and generate one.'}
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href={`/candidates/${id}/interview-kit`}>Open kits list</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-8 p-8">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
        <Link href="/candidates" className="hover:text-slate-900 dark:hover:text-slate-50">
          Candidates
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5" />
        <Link href={`/candidates/${id}`} className="hover:text-slate-900 dark:hover:text-slate-50">
          {kit.candidateName}
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5" />
        <Link
          href={`/candidates/${id}/interview-kit`}
          className="hover:text-slate-900 dark:hover:text-slate-50"
        >
          Interview kits
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5" />
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {kit.interviewType.replace(/_/g, ' ')} · Round {kit.round}
        </span>
      </nav>

      <PageHeader
        title={`${kit.candidateName} — Interview Kit`}
        description={`${kit.position} · ${kit.interviewType.replace(/_/g, ' ')} · ${kit.durationMinutes} min`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/candidates/${id}/interview-kit`}>
                <ListChecksIcon className="mr-2 h-4 w-4" />
                All kits
              </Link>
            </Button>
            {!kit.hasEvaluation && (
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => {
                  window.location.href = `/candidates/${id}/interview-kit/${kit.interviewId}/evaluate`
                }}
              >
                <ClipboardListIcon className="mr-2 h-4 w-4" />
                Start evaluation
              </Button>
            )}
            {kit.hasEvaluation && (
              <Button
                variant="outline"
                onClick={() => {
                  window.location.href = `/candidates/${id}/interview-kit/${kit.interviewId}/evaluate`
                }}
              >
                <FileTextIcon className="mr-2 h-4 w-4" />
                View evaluation
              </Button>
            )}
          </div>
        }
      />

      {/* Interview header card */}
      <Card>
        <CardContent className="grid gap-6 p-6 md:grid-cols-4">
          <Stat
            icon={MicIcon}
            label="Recommended type"
            value={kit.overview.recommendedType.replace(/_/g, ' ')}
          />
          <Stat
            icon={ClockIcon}
            label="Recommended duration"
            value={`${kit.overview.recommendedDurationMinutes} min`}
          />
          <Stat
            icon={TargetIcon}
            label="Match score"
            value={kit.matchScore != null ? `${kit.matchScore} / 100` : '—'}
            accent={
              kit.matchScore != null && kit.matchScore >= 70
                ? 'emerald'
                : kit.matchScore != null && kit.matchScore >= 50
                  ? 'amber'
                  : 'slate'
            }
          />
          <Stat
            icon={TrendingUpIcon}
            label="Interview score"
            value={kit.interviewScore != null ? `${kit.interviewScore} / 100` : 'Not yet scored'}
            accent={
              kit.interviewScore != null && kit.interviewScore >= 70
                ? 'emerald'
                : kit.interviewScore != null && kit.interviewScore >= 50
                  ? 'amber'
                  : 'slate'
            }
          />
        </CardContent>
      </Card>

      {/* Interview focus */}
      <Card>
        <CardHeader>
          <CardTitle>Interview focus</CardTitle>
          <CardDescription>
            A short summary of what to concentrate on for this specific candidate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
            {kit.overview.interviewFocus || '—'}
          </p>
        </CardContent>
      </Card>

      {/* Candidate snapshot */}
      <Card>
        <CardHeader>
          <CardTitle>Candidate snapshot</CardTitle>
          <CardDescription>
            Top strengths, gaps, and claims that need to be validated during the interview.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-3">
          <SnapshotColumn
            title="Key strengths"
            color="emerald"
            items={kit.candidateSnapshot.keyStrengths}
            emptyMessage="No standout strengths flagged."
          />
          <SnapshotColumn
            title="Key gaps"
            color="amber"
            items={kit.candidateSnapshot.keyGaps}
            emptyMessage="No material gaps flagged."
          />
          <SnapshotColumn
            title="Validate on the call"
            color="sky"
            items={kit.candidateSnapshot.areasRequiringValidation}
            emptyMessage="Nothing specific to re-validate."
          />
        </CardContent>
      </Card>

      {/* Questions by purpose */}
      <Card>
        <CardHeader>
          <CardTitle>Questions ({kit.questions.length})</CardTitle>
          <CardDescription>
            Organized by purpose. Mark each question as asked and add notes inline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {PURPOSE_ORDER.map(purpose => {
            const qs = kit.questions.filter(q => q.purpose === purpose)
            if (qs.length === 0) return null
            const meta = PURPOSE_LABELS[purpose] ?? PURPOSE_LABELS.ROLE_SPECIFIC
            return (
              <section key={purpose}>
                <header className="mb-3 flex items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                      meta.color
                    )}
                  >
                    {meta.label}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {meta.description}
                  </span>
                </header>
                <ol className="space-y-4">
                  {qs.map((q, i) => (
                    <QuestionCard key={q.id} question={q} index={i + 1} />
                  ))}
                </ol>
              </section>
            )
          })}
        </CardContent>
      </Card>

      {/* Scorecard preview */}
      <Card>
        <CardHeader>
          <CardTitle>Scorecard ({kit.scorecard.length} criteria)</CardTitle>
          <CardDescription>
            Weights sum to 100. The application computes the final interview score
            deterministically from your per-criterion ratings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Criterion</th>
                  <th className="px-4 py-2.5">Weight</th>
                  <th className="px-4 py-2.5">Poor (1)</th>
                  <th className="px-4 py-2.5">Meets (3)</th>
                  <th className="px-4 py-2.5">Excellent (5)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {kit.scorecard.map(c => (
                  <tr key={c.name} className="text-slate-700 dark:text-slate-200">
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-slate-900 dark:text-slate-50">
                        {c.name}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {c.description}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top font-mono">{c.weight}%</td>
                    <td className="px-4 py-3 align-top text-xs">{c.poorIndicator}</td>
                    <td className="px-4 py-3 align-top text-xs">{c.meetsIndicator}</td>
                    <td className="px-4 py-3 align-top text-xs">{c.excellentIndicator}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Footer call-to-action */}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-6 dark:border-slate-700">
        {kit.hasEvaluation ? (
          <div className="flex items-center gap-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2Icon className="h-5 w-5" />
            <span>
              Evaluation submitted — interview score <strong>{kit.interviewScore}/100</strong> ·
              recommendation <strong>{kit.evaluationRecommendation ?? '—'}</strong>
            </span>
          </div>
        ) : (
          <Button
            size="lg"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => {
              window.location.href = `/candidates/${id}/interview-kit/${kit.interviewId}/evaluate`
            }}
          >
            <PlayCircleIcon className="mr-2 h-5 w-5" />
            Start structured evaluation
          </Button>
        )}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Sub-components (local copies — same pattern as the list page)
// -----------------------------------------------------------------------------

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof SparklesIcon
  label: string
  value: string
  accent?: 'emerald' | 'amber' | 'slate'
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div
        className={cn(
          'text-xl font-semibold capitalize',
          accent === 'emerald' && 'text-emerald-700 dark:text-emerald-300',
          accent === 'amber' && 'text-amber-700 dark:text-amber-300',
          accent === 'slate' && 'text-slate-700 dark:text-slate-200',
          !accent && 'text-slate-900 dark:text-slate-50'
        )}
      >
        {value}
      </div>
    </div>
  )
}

function SnapshotColumn({
  title,
  items,
  color,
  emptyMessage,
}: {
  title: string
  items: string[]
  color: 'emerald' | 'amber' | 'sky'
  emptyMessage: string
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <FlagIcon className="h-3.5 w-3.5" />
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>
      ) : (
        <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
          {items.map((it, i) => (
            <li
              key={i}
              className={cn(
                'rounded-md px-2.5 py-1.5 ring-1 ring-inset',
                color === 'emerald' &&
                  'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800',
                color === 'amber' &&
                  'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800',
                color === 'sky' &&
                  'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800'
              )}
            >
              {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function QuestionCard({
  question,
  index,
}: {
  question: InterviewKitView['questions'][number]
  index: number
}) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex flex-wrap items-start gap-3">
        <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {index}
        </span>
        <div className="flex-1 space-y-2">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {question.category}
          </h4>
          <p className="text-base font-medium text-slate-900 dark:text-slate-50">
            &ldquo;{question.question}&rdquo;
          </p>
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
              Why this question
            </summary>
            <p className="mt-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
              {question.whyThisQuestion}
            </p>
          </details>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-emerald-50/50 p-3 text-sm dark:bg-emerald-950/20">
              <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                <CheckCircle2Icon className="h-3.5 w-3.5" /> Strong answer indicators
              </div>
              <p className="text-slate-700 dark:text-slate-200">{question.strongAnswer}</p>
            </div>
            <div className="rounded-md bg-rose-50/50 p-3 text-sm dark:bg-rose-950/20">
              <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                <FlagIcon className="h-3.5 w-3.5" /> Red flags
              </div>
              <p className="text-slate-700 dark:text-slate-200">{question.redFlags}</p>
            </div>
          </div>
          {question.suggestedFollowUp && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-200">Follow-up:</span>{' '}
              {question.suggestedFollowUp}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}
