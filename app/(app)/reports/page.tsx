'use client'

import { useState } from 'react'
import {
  CalendarIcon,
  DownloadIcon,
  FileTextIcon,
  MailIcon,
  PlayIcon,
  PlusIcon,
  ShareIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { cn } from '@/lib/utils'

type Tab = 'templates' | 'recent' | 'scheduled'

interface ReportTemplate {
  id: string
  name: string
  description: string
  category: 'Funnel' | 'Team' | 'Time' | 'Quality'
  runs: number
  lastRun: string
}

const TEMPLATES: ReportTemplate[] = [
  {
    id: 't-1',
    name: 'Weekly Funnel Summary',
    description: 'Pipeline movement, conversion rates, and stage-by-stage drop-off.',
    category: 'Funnel',
    runs: 47,
    lastRun: '2 days ago',
  },
  {
    id: 't-2',
    name: 'Time to Hire by Department',
    description: 'Median days from job req to offer, broken down by team.',
    category: 'Time',
    runs: 32,
    lastRun: 'Yesterday',
  },
  {
    id: 't-3',
    name: 'Hiring Manager Scorecard Rollup',
    description: 'Aggregate interviewer feedback and decision trends.',
    category: 'Quality',
    runs: 18,
    lastRun: 'Last week',
  },
  {
    id: 't-4',
    name: 'Source Attribution',
    description: 'Which channels bring the most qualified candidates.',
    category: 'Funnel',
    runs: 24,
    lastRun: '4 days ago',
  },
  {
    id: 't-5',
    name: 'Team Capacity Forecast',
    description: 'Project hires against open reqs to identify bottlenecks.',
    category: 'Team',
    runs: 9,
    lastRun: 'Last month',
  },
  {
    id: 't-6',
    name: 'Interview-to-Offer Conversion',
    description: 'Drill into pass rates by stage, role, and interviewer.',
    category: 'Quality',
    runs: 14,
    lastRun: '3 weeks ago',
  },
]

const RECENT = [
  { id: 'r-1', name: 'Q2 hiring recap', generated: 'Generated 3 days ago', size: '1.2 MB' },
  { id: 'r-2', name: 'Engineering funnel — June', generated: 'Generated last week', size: '740 KB' },
  { id: 'r-3', name: 'Weekly Funnel Summary', generated: 'Generated 2 days ago', size: '320 KB' },
  { id: 'r-4', name: 'Source attribution', generated: 'Generated 4 days ago', size: '510 KB' },
]

const SCHEDULED = [
  { id: 's-1', name: 'Weekly Funnel Summary', cadence: 'Every Monday 9:00 AM', recipients: 4 },
  { id: 's-2', name: 'Time to Hire by Department', cadence: '1st of each month', recipients: 6 },
  { id: 's-3', name: 'Hiring Manager Scorecard Rollup', cadence: 'Every Friday 4:00 PM', recipients: 8 },
]

const TABS: { id: Tab; label: string }[] = [
  { id: 'templates', label: 'Templates' },
  { id: 'recent', label: 'Recent' },
  { id: 'scheduled', label: 'Scheduled' },
]

const CATEGORY_STYLES: Record<ReportTemplate['category'], string> = {
  Funnel: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  Team: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  Time: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  Quality: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('templates')

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Reports"
        description="Generate, schedule, and share reports that surface the metrics your leadership team actually needs. No SQL, no analyst required."
        actions={
          <>
            <Button variant="outline">
              <CalendarIcon className="h-4 w-4" />
              Schedule report
            </Button>
            <Button>
              <PlusIcon className="h-4 w-4" />
              New report
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryStat label="Templates available" value={TEMPLATES.length} hint="Ready to run" />
        <SummaryStat label="Generated this month" value={RECENT.length} hint="Across all teams" />
        <SummaryStat
          label="Scheduled reports"
          value={SCHEDULED.length}
          hint="Delivered automatically"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Reports</CardTitle>
              <CardDescription>
                {tab === 'templates' && 'Pre-built report templates you can run in one click.'}
                {tab === 'recent' && 'The reports you and your team have generated recently.'}
                {tab === 'scheduled' && 'Recurring reports delivered to your inbox on a cadence.'}
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
        <CardContent>
          {tab === 'templates' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {TEMPLATES.map(t => (
                <TemplateCard key={t.id} template={t} />
              ))}
            </div>
          )}

          {tab === 'recent' &&
            (RECENT.length > 0 ? (
              <div className="space-y-2">
                {RECENT.map(r => (
                  <div
                    key={r.id}
                    className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 transition-colors hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700/50">
                        <FileTextIcon className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {r.name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {r.generated} · {r.size}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">
                        <ShareIcon className="h-3.5 w-3.5" />
                        Share
                      </Button>
                      <Button size="sm">
                        <DownloadIcon className="h-3.5 w-3.5" />
                        Download
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={FileTextIcon}
                title="No reports yet"
                description="Run a template to see it appear here."
              />
            ))}

          {tab === 'scheduled' &&
            (SCHEDULED.length > 0 ? (
              <div className="space-y-2">
                {SCHEDULED.map(s => (
                  <div
                    key={s.id}
                    className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 md:flex-row md:items-center md:justify-between dark:border-slate-700"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
                        <MailIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {s.name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {s.cadence} · {s.recipients} recipient
                          {s.recipients === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm">
                        Pause
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={CalendarIcon}
                title="No scheduled reports"
                description="Set up recurring delivery to keep stakeholders aligned."
              />
            ))}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryStat({
  label,
  value,
  hint,
}: {
  label: string
  value: number
  hint: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
          {label}
        </p>
        <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          {value}
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      </CardContent>
    </Card>
  )
}

function TemplateCard({ template }: { template: ReportTemplate }) {
  return (
    <article className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700/50">
          <FileTextIcon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            CATEGORY_STYLES[template.category]
          )}
        >
          {template.category}
        </span>
      </div>

      <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-50">
        {template.name}
      </h3>
      <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
        {template.description}
      </p>

      <div className="mt-4 flex flex-1 items-end justify-between border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-700/50 dark:text-slate-400">
        <span>{template.runs} runs · {template.lastRun}</span>
        <Button size="sm">
          <PlayIcon className="h-3.5 w-3.5" />
          Run
        </Button>
      </div>
    </article>
  )
}
