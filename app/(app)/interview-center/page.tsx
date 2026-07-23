'use client'

/**
 * Sprint 7 — Interview Center.
 *
 * Live data from Prisma. Upcoming / Today's / Past / Completed tabs.
 * Each row links to the candidate's interview kit.
 */

import Link from 'next/link'
import { use, useEffect, useState, useTransition } from 'react'
import {
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  FileTextIcon,
  MicIcon,
  UsersIcon,
} from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/shared/card'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { getInterviewCenterAction, type InterviewCenterData, type CandidateInterviewListItem } from '@/app/(app)/candidates/[id]/interview-kit/actions'
import { cn } from '@/lib/utils'

type TabId = 'today' | 'upcoming' | 'past' | 'completed'

export default function InterviewCenterPage() {
  const [data, setData] = useState<InterviewCenterData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabId>('today')
  const [, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    startTransition(async () => {
      const r = await getInterviewCenterAction()
      if (cancelled) return
      if (r.ok) setData(r.data)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading || !data) {
    return (
      <div className="space-y-6 p-8">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800" />
      </div>
    )
  }

  const tabs: Array<{ id: TabId; label: string; count: number; items: CandidateInterviewListItem[] }> = [
    { id: 'today', label: 'Today', count: data.counts.today, items: data.today },
    { id: 'upcoming', label: 'Upcoming', count: data.counts.upcoming, items: data.upcoming },
    { id: 'past', label: 'Past', count: data.counts.past, items: data.past },
    { id: 'completed', label: 'Completed', count: data.counts.completed, items: data.completed },
  ]
  const active = tabs.find(t => t.id === tab) ?? tabs[0]

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Interview Center"
        description="Schedule, conduct, and evaluate structured interviews."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Today" value={data.counts.today} icon={ClockIcon} accent="sky" />
        <KpiCard label="Upcoming" value={data.counts.upcoming} icon={CalendarIcon} accent="indigo" />
        <KpiCard label="Completed" value={data.counts.completed} icon={CheckCircle2Icon} accent="emerald" />
        <KpiCard label="All time" value={data.counts.all} icon={MicIcon} accent="slate" />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-700">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition',
              t.id === tab
                ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            )}
          >
            {t.label}
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs',
                t.id === tab
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              )}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {active.items.length === 0 ? (
        <EmptyState
          icon={MicIcon}
          title={`No ${active.label.toLowerCase()} interviews`}
          description={
            tab === 'today'
              ? "You don't have any interviews scheduled for today. New interviews created from a candidate's interview kit will appear here automatically."
              : tab === 'upcoming'
                ? 'No interviews are scheduled in the future yet.'
                : tab === 'completed'
                  ? 'No completed interviews yet. After an evaluation is submitted, the interview will appear here.'
                  : 'No past interviews to show.'
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
              {active.items.map(item => (
                <InterviewRow key={item.id} item={item} tab={tab} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function KpiCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string
  value: number
  icon: typeof MicIcon
  accent: 'sky' | 'emerald' | 'indigo' | 'slate'
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {label}
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">{value}</p>
          </div>
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg',
              accent === 'sky' && 'bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300',
              accent === 'emerald' && 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300',
              accent === 'indigo' && 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300',
              accent === 'slate' && 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function InterviewRow({ item, tab }: { item: CandidateInterviewListItem; tab: TabId }) {
  const date = new Date(item.scheduledAt)
  const dateStr = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40">
      <div className="flex flex-1 items-center gap-4">
        <div
          className={cn(
            'flex h-12 w-12 flex-col items-center justify-center rounded-lg text-center',
            item.status === 'COMPLETED'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
          )}
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide">
            {date.toLocaleDateString(undefined, { month: 'short' })}
          </div>
          <div className="text-lg font-bold leading-none">{date.getDate()}</div>
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
            {item.title}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <CalendarIcon className="h-3 w-3" />
              {dateStr} · {timeStr}
            </span>
            <span className="inline-flex items-center gap-1">
              <ClockIcon className="h-3 w-3" />
              {item.durationMinutes} min
            </span>
            {item.participantNames.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <UsersIcon className="h-3 w-3" />
                {item.participantNames.join(', ')}
              </span>
            )}
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {item.type.replace(/_/g, ' ')}
            </span>
            {item.status === 'COMPLETED' && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                Completed
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {item.hasEvaluation ? (
          <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800">
            {item.interviewScore ?? 0} / 100 · {item.evaluationRecommendation?.replace(/_/g, ' ') ?? '—'}
          </span>
        ) : (
          <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Awaiting evaluation
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.location.href = `/candidates/${item.candidateId}/interview-kit/${item.id}`
          }}
        >
          <FileTextIcon className="mr-1.5 h-3.5 w-3.5" />
          {item.hasEvaluation ? 'View' : tab === 'completed' ? 'View' : 'Open kit'}
        </Button>
        {/* Sprint 17 — "Add to calendar" download link. The URL works
            for both logged-in TalentOS users and the candidate (who
            has no account); the random token proves the link is genuine. */}
        {item.reminderToken && (
          <a
            href={`/api/public/interview.ics?id=${item.id}&token=${item.reminderToken}`}
            download
            aria-label="Download .ics file for your calendar"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            .ics
          </a>
        )}
      </div>
    </li>
  )
}
