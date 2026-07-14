'use client'

import { useState } from 'react'
import {
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  PlusIcon,
  UsersIcon,
  VideoIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { cn } from '@/lib/utils'

type TabId = 'upcoming' | 'past' | 'today' | 'all'

interface Interview {
  id: string
  candidate: string
  role: string
  stage: string
  type: 'Phone screen' | 'Technical' | 'On-site' | 'Final' | 'Culture fit'
  date: string
  time: string
  duration: string
  interviewers: string[]
  meetingLink: string
}

const UPCOMING: Interview[] = [
  {
    id: 'i-001',
    candidate: 'Sarah Chen',
    role: 'Senior Software Engineer',
    stage: 'Technical round',
    type: 'Technical',
    date: 'Tue, Jul 16',
    time: '10:00 AM',
    duration: '60 min',
    interviewers: ['Priya Patel', 'Marcus Chen'],
    meetingLink: '#',
  },
  {
    id: 'i-002',
    candidate: 'Elena Rodriguez',
    role: 'Product Manager',
    stage: 'On-site loop',
    type: 'On-site',
    date: 'Wed, Jul 17',
    time: '2:00 PM',
    duration: '240 min',
    interviewers: ['Jordan Rivera', 'Priya Patel', 'Marcus Chen', 'Elena R.'],
    meetingLink: '#',
  },
  {
    id: 'i-003',
    candidate: 'James Williams',
    role: 'Senior Software Engineer',
    stage: 'Recruiter screen',
    type: 'Phone screen',
    date: 'Thu, Jul 18',
    time: '11:30 AM',
    duration: '30 min',
    interviewers: ['Jordan Rivera'],
    meetingLink: '#',
  },
  {
    id: 'i-004',
    candidate: 'Lisa Anderson',
    role: 'UX/UI Designer',
    stage: 'Portfolio review',
    type: 'Culture fit',
    date: 'Fri, Jul 19',
    time: '9:00 AM',
    duration: '45 min',
    interviewers: ['Priya Patel', 'Marcus Chen'],
    meetingLink: '#',
  },
]

const PAST: Interview[] = [
  {
    id: 'i-p1',
    candidate: 'Marcus Johnson',
    role: 'Senior Software Engineer',
    stage: 'Final round',
    type: 'Final',
    date: 'Mon, Jul 8',
    time: '3:00 PM',
    duration: '60 min',
    interviewers: ['Jordan Rivera', 'Priya Patel'],
    meetingLink: '#',
  },
  {
    id: 'i-p2',
    candidate: 'Priya Patel',
    role: 'UX/UI Designer',
    stage: 'On-site loop',
    type: 'On-site',
    date: 'Wed, Jul 3',
    time: '10:00 AM',
    duration: '180 min',
    interviewers: ['Jordan Rivera', 'Marcus Chen', 'Elena R.'],
    meetingLink: '#',
  },
]

const TABS: { id: TabId; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'today', label: 'Today' },
  { id: 'past', label: 'Past' },
  { id: 'all', label: 'All' },
]

export default function InterviewCenterPage() {
  const [tab, setTab] = useState<TabId>('upcoming')

  const stats = {
    upcoming: UPCOMING.length,
    today: UPCOMING.filter(i => i.date.includes('Tue, Jul 16')).length,
    past: PAST.length,
  }

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Interview Center"
        description="Plan, run, and review every interview loop. Keep candidates, hiring managers, and interviewers in sync from a single place."
        actions={
          <>
            <Button variant="outline">
              <CalendarIcon className="h-4 w-4" />
              Sync calendars
            </Button>
            <Button>
              <PlusIcon className="h-4 w-4" />
              Schedule interview
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ClockIcon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Upcoming</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                {stats.upcoming}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <CalendarIcon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Today</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                {stats.today}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-500/10 text-slate-600 dark:text-slate-400">
              <CheckCircle2Icon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Completed</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                {stats.past}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Interviews</CardTitle>
              <CardDescription>
                {tab === 'upcoming' && 'Interviews scheduled in the next 7 days.'}
                {tab === 'today' && "Interviews on today's calendar."}
                {tab === 'past' && 'Recently completed interviews.'}
                {tab === 'all' && 'Every interview across your pipeline.'}
              </CardDescription>
            </div>
            <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
              {TABS.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    tab === t.id
                      ? 'bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-50'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {tab === 'past' ? (
            PAST.length > 0 ? (
              PAST.map(i => <InterviewRow key={i.id} interview={i} past />)
            ) : (
              <EmptyState title="No past interviews yet" />
            )
          ) : UPCOMING.length > 0 ? (
            UPCOMING.map(i => <InterviewRow key={i.id} interview={i} />)
          ) : (
            <EmptyState title="Nothing scheduled" description="When you book interviews, they'll appear here." />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function InterviewRow({
  interview,
  past = false,
}: {
  interview: Interview
  past?: boolean
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:shadow-sm md:flex-row md:items-center md:justify-between dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-slate-600">
      <div className="flex flex-1 items-start gap-4">
        <div
          className={cn(
            'hidden h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl text-center md:flex',
            past
              ? 'bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400'
              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
          )}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider">
            {interview.date.split(',')[0]}
          </span>
          <span className="text-lg font-bold">
            {interview.date.split(' ')[2]}
          </span>
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {interview.candidate}
            </h3>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {interview.type}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {interview.role} · {interview.stage}
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <ClockIcon className="h-3.5 w-3.5" />
              {interview.time} · {interview.duration}
            </span>
            <span className="inline-flex items-center gap-1">
              <UsersIcon className="h-3.5 w-3.5" />
              {interview.interviewers.length} interviewer
              {interview.interviewers.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex -space-x-1.5 pt-1">
            {interview.interviewers.slice(0, 4).map((name, i) => (
              <div
                key={name}
                title={name}
                className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-emerald-500/10 text-[10px] font-semibold text-emerald-700 dark:border-slate-800 dark:text-emerald-300"
                style={{ zIndex: 4 - i }}
              >
                {name.split(' ').map(p => p[0]).join('').slice(0, 2)}
              </div>
            ))}
            {interview.interviewers.length > 4 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-700 dark:text-slate-300">
                +{interview.interviewers.length - 4}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 md:flex-shrink-0">
        {past ? (
          <Button variant="outline" size="sm">
            View scorecard
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm">
              Reschedule
            </Button>
            <Button size="sm">
              <VideoIcon className="h-3.5 w-3.5" />
              Join
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
