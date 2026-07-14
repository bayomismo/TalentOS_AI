'use client'

import {
  ArrowDownIcon,
  ArrowUpIcon,
  BriefcaseIcon,
  DownloadIcon,
  SparklesIcon,
  TimerIcon,
  TrendingUpIcon,
  UserCheckIcon,
  UsersIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/shared/card'
import { Section } from '@/components/shared/section'
import { Button } from '@/components/ui/button'
import { ActivityTimeline } from '@/features/dashboard/components/activity-timeline'
import { PipelineColumn } from '@/features/dashboard/components/pipeline-column'
import { StatCard } from '@/features/dashboard/components/stat-card'
import { HiringRequestsTable } from '@/features/hiring-requests/components/hiring-requests-table'
import {
  getActivities,
  getCandidatesByStage,
  getMetrics,
  getPositions,
} from '@/mocks/seed-data'

export default function DashboardPage() {
  const candidatesByStage = getCandidatesByStage()
  const metrics = getMetrics()
  const activities = getActivities()
  const positions = getPositions()

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Recruitment Dashboard"
        description="A real-time view of your hiring funnel. Track open roles, candidate flow, and recent activity across every team in one place."
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
        {metrics.map((metric, idx) => (
          <StatCard
            key={idx}
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
        <HiringRequestsTable positions={positions} />
      </Section>

      <Section
        title="Candidate pipeline"
        description="Where every active candidate currently sits in the funnel."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          <PipelineColumn
            title="Applied"
            stage="applied"
            candidates={candidatesByStage.applied}
            count={candidatesByStage.applied.length}
          />
          <PipelineColumn
            title="Screening"
            stage="screening"
            candidates={candidatesByStage.screening}
            count={candidatesByStage.screening.length}
          />
          <PipelineColumn
            title="Interview"
            stage="interview"
            candidates={candidatesByStage.interview}
            count={candidatesByStage.interview.length}
          />
          <PipelineColumn
            title="Offer"
            stage="offer"
            candidates={candidatesByStage.offer}
            count={candidatesByStage.offer.length}
          />
          <PipelineColumn
            title="Hired"
            stage="hired"
            candidates={candidatesByStage.hired}
            count={candidatesByStage.hired.length}
          />
        </div>
      </Section>

      <Section
        title="Recent activity"
        description="The latest events across all your open roles."
      >
        <Card>
          <CardContent className="p-6">
            <ActivityTimeline activities={activities} />
          </CardContent>
        </Card>
      </Section>
    </div>
  )
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
