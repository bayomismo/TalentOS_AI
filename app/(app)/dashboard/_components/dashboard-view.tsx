'use client'

/**
 * Dashboard view — client component.
 *
 * Fetches initial data via the server action, then subscribes to the
 * global event bus for live updates from the AI Recruiter wizard.
 * Every layout/visual element matches the Sprint 2 dashboard; the only
 * change is that data flows from Prisma + events instead of static mocks.
 */

import { useEffect, useState, useTransition } from 'react'
import {
  BriefcaseIcon,
  DownloadIcon,
  SparklesIcon,
  TimerIcon,
  TrendingUpIcon,
  UserCheckIcon,
  UsersIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from 'lucide-react'

import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/shared/card'
import { Section } from '@/components/shared/section'
import { Button } from '@/components/ui/button'
import { HiringRequestsTable } from '@/features/hiring-requests/components/hiring-requests-table'
import { PipelineColumn } from '@/features/dashboard/components/pipeline-column'
import { StatCard } from '@/features/dashboard/components/stat-card'
import { ActivityTimeline } from '@/features/dashboard/components/activity-timeline'
import { StatusBadge } from '@/features/shared/components/status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import Link from 'next/link'
import { useTalentOSEvent } from '@/lib/events'
import { getDashboardDataAction, type DashboardData } from '../actions'
import type {
  ActivitySnapshot,
  AISnapshot,
  HiringRequestSnapshot,
  JobDescriptionSnapshot,
} from '@/lib/events/types'
import type { Activity, Candidate, Position } from '@/types'
import { cn } from '@/lib/utils'

const EMPTY_DATA: DashboardData = {
  positions: [],
  candidatesByStage: { applied: 0, screening: 0, interview: 0, offer: 0, hired: 0 },
  metrics: [],
  activities: [],
}

export function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      try {
        const result = await getDashboardDataAction()
        setData(result)
      } catch (err) {
        console.error('[dashboard] failed to load initial data', err)
        setData(EMPTY_DATA)
      }
    })
  }, [])

  // Live updates — subscribe to the event bus.
  useTalentOSEvent('HiringRequestCreated', event => {
    setData(prev => {
      if (!prev) return prev
      const newPos = positionFromSnapshot(event.payload.hiringRequest)
      // Already in the list? Skip.
      if (prev.positions.some(p => p.id === newPos.id)) return prev
      return {
        ...prev,
        positions: [newPos, ...prev.positions],
        metrics: prev.metrics.map(m =>
          m.label === 'Open Positions'
            ? { ...m, value: Number(m.value) + 1, change: Number(m.change) + 1 }
            : m
        ),
        activities: prependActivity(prev.activities, event.payload.activity, event.payload.hiringRequest.title),
      }
    })
  })

  useTalentOSEvent('ActivityRecorded', event => {
    setData(prev => {
      if (!prev) return prev
      if (prev.activities.some(a => a.id === event.payload.activity.id)) return prev
      return {
        ...prev,
        activities: prependActivity(prev.activities, event.payload.activity, null),
      }
    })
  })

  if (!data) {
    return (
      <div className="space-y-8 p-8">
        <PageHeader
          title="Recruitment Dashboard"
          description="Loading live data from your workspace…"
        />
        <SkeletonGrid />
      </div>
    )
  }

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Recruitment Dashboard"
        description="A real-time view of your hiring funnel. Live data from the database, plus instant updates whenever a hiring request is created from the AI Recruiter."
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <SparklesIcon className="h-3 w-3" />
            Live data
          </span>
        }
        actions={
          <>
            <Button variant="outline">
              <DownloadIcon className="h-4 w-4" />
              Export
            </Button>
            <Button>
              <SparklesIcon className="h-4 w-4" />
              New hiring package
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {data.metrics.map((metric, idx) => (
          <StatCard
            key={`${metric.label}-${idx}`}
            label={metric.label}
            value={metric.value}
            change={metric.change}
            trend={metric.trend}
            icon={iconForMetric(metric.label)}
          />
        ))}
      </div>

      <Section
        title="Open positions"
        description="Every role your team is actively hiring for."
        action={
          <Button variant="outline" size="sm">
            View all
          </Button>
        }
      >
        {data.positions.length > 0 ? (
          <HiringRequestsTable positions={toTablePositions(data.positions)} />
        ) : (
          <EmptyPositionsCard />
        )}
      </Section>

      <Section
        title="Candidate pipeline"
        description="Where every active candidate currently sits in the funnel."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          <PipelineColumn
            title="Applied"
            stage="applied"
            candidates={[]}
            count={data.candidatesByStage.applied}
          />
          <PipelineColumn
            title="Screening"
            stage="screening"
            candidates={[]}
            count={data.candidatesByStage.screening}
          />
          <PipelineColumn
            title="Interview"
            stage="interview"
            candidates={[]}
            count={data.candidatesByStage.interview}
          />
          <PipelineColumn
            title="Offer"
            stage="offer"
            candidates={[]}
            count={data.candidatesByStage.offer}
          />
          <PipelineColumn
            title="Hired"
            stage="hired"
            candidates={[]}
            count={data.candidatesByStage.hired}
          />
        </div>
      </Section>

      <Section
        title="Recent activity"
        description="The latest events across all your open roles."
      >
        <Card>
          <CardContent className="p-6">
            {data.activities.length > 0 ? (
              <ActivityTimeline activities={toTimelineActivities(data.activities)} />
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No activity yet. Create a hiring request from the AI Recruiter to populate this feed.
              </p>
            )}
          </CardContent>
        </Card>
      </Section>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function positionFromSnapshot(snapshot: HiringRequestSnapshot) {
  return {
    id: snapshot.id,
    title: snapshot.title,
    department: snapshot.department,
    openings: snapshot.openings,
    filled: snapshot.filled ?? 0,
    candidates: 0,
    status: snapshot.status === 'CLOSED' || snapshot.status === 'CANCELLED' || snapshot.status === 'FILLED' ? 'closed' as const : 'active' as const,
    createdAt: snapshot.createdAt,
  }
}

function prependActivity(
  activities: DashboardData['activities'],
  snapshot: ActivitySnapshot,
  positionTitle: string | null,
): DashboardData['activities'] {
  return [
    {
      id: snapshot.id,
      type: snapshot.type,
      candidateName: snapshot.candidateName,
      positionTitle: positionTitle ?? snapshot.candidateName,
      details: snapshot.description,
      timestamp: snapshot.occurredAt,
    },
    ...activities,
  ].slice(0, 20)
}

function toTablePositions(positions: DashboardData['positions']): Position[] {
  return positions.map(p => ({
    id: p.id,
    title: p.title,
    department: p.department,
    openings: p.openings,
    filled: p.filled ?? 0,
    candidates: p.candidates,
    status: p.status,
    createdAt: new Date(p.createdAt),
  }))
}

function toTimelineActivities(activities: DashboardData['activities']): Activity[] {
  return activities.map(a => {
    const at = a as unknown as { type: string; candidateName: string | null; positionTitle: string | null; details: string | null; timestamp: string }
    return {
      id: a.id,
      type: normalizeActivityType(at.type),
      candidateName: at.candidateName ?? at.positionTitle ?? 'System',
      positionTitle: at.positionTitle ?? '',
      timestamp: new Date(at.timestamp),
      details: at.details ?? undefined,
    }
  })
}

function normalizeActivityType(
  type: string,
): Activity['type'] {
  switch (type) {
    case 'APPLICATION_RECEIVED':
      return 'application'
    case 'CANDIDATE_MOVED':
      return 'moved'
    case 'INTERVIEW_SCHEDULED':
    case 'INTERVIEW_COMPLETED':
    case 'INTERVIEW_CANCELLED':
      return 'interview'
    case 'OFFER_EXTENDED':
    case 'OFFER_ACCEPTED':
    case 'OFFER_DECLINED':
      return 'offer'
    case 'HIRED':
      return 'hired'
    case 'HIRING_REQUEST_CREATED':
    case 'HIRING_REQUEST_UPDATED':
    case 'HIRING_REQUEST_CLOSED':
    default:
      return 'moved'
  }
}

function iconForMetric(label: string) {
  const map: Record<string, React.ReactNode> = {
    'Open Positions': <BriefcaseIcon className="h-5 w-5" />,
    'Active Candidates': <UsersIcon className="h-5 w-5" />,
    'Avg. Time to Hire': <TimerIcon className="h-5 w-5" />,
    'Offer Conversion': <UserCheckIcon className="h-5 w-5" />,
    'Pipeline Health': <TrendingUpIcon className="h-5 w-5" />,
    'Candidates Hired (YTD)': <ArrowUpIcon className="h-5 w-5" />,
  }
  return map[label] ?? <ArrowDownIcon className="h-5 w-5" />
}

function EmptyPositionsCard() {
  return (
    <EmptyState
      icon={SparklesIcon}
      title="No open positions yet"
      description="Open the AI Recruiter, describe the role you need, and the engine will generate a complete hiring package you can publish."
      actions={
        <Link href="/ai-recruiter">
          <Button>Open AI Recruiter</Button>
        </Link>
      }
    />
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-24 animate-pulse rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
          )}
        />
      ))}
    </div>
  )
}
