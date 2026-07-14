'use client'

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
    <div className="space-y-6 p-8">
      <section>
        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-50">
          Key Metrics
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {metrics.map((metric, idx) => (
            <StatCard
              key={idx}
              label={metric.label}
              value={metric.value}
              change={metric.change}
              trend={metric.trend}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-50">
          Open Positions
        </h3>
        <HiringRequestsTable positions={positions} />
      </section>

      <section>
        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-50">
          Candidate Pipeline
        </h3>
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
      </section>

      <section>
        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-50">
          Recent Activity
        </h3>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <ActivityTimeline activities={activities} />
        </div>
      </section>
    </div>
  )
}
