import { ClockIcon, FileTextIcon, MailIcon, PlayIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Reports — Coming Soon.
 *
 * Sprint 12 audit: this page previously rendered 6 hardcoded report
 * templates, fake "recent runs", and a fake "scheduled" list. The
 * underlying scheduler, runner, and PDF/CSV export pipeline do not
 * exist yet, so any data shown was misleading.
 *
 * Per the audit policy ("no fake functionality, no dead buttons,
 * no mock data where real data exists"), this page now declares
 * the upcoming feature surface explicitly and shows a Coming Soon
 * banner. The 6 template cards remain so customers can see what
 * we'll ship, but the Run / Schedule / Share / Download buttons
 * are disabled with a clear "coming soon" hint.
 */

const CATEGORY_STYLES: Record<string, string> = {
  Funnel: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  Team: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  Time: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  Quality: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
}

interface PlannedTemplate {
  id: string
  name: string
  description: string
  category: 'Funnel' | 'Team' | 'Time' | 'Quality'
}

const PLANNED_TEMPLATES: PlannedTemplate[] = [
  {
    id: 't-1',
    name: 'Weekly Funnel Summary',
    description: 'Pipeline movement, conversion rates, and stage-by-stage drop-off.',
    category: 'Funnel',
  },
  {
    id: 't-2',
    name: 'Time to Hire by Department',
    description: 'Median days from job req to offer, broken down by team.',
    category: 'Time',
  },
  {
    id: 't-3',
    name: 'Hiring Manager Scorecard Rollup',
    description: 'Aggregate interviewer feedback and decision trends.',
    category: 'Quality',
  },
  {
    id: 't-4',
    name: 'Source Attribution',
    description: 'Which channels bring the most qualified candidates.',
    category: 'Funnel',
  },
  {
    id: 't-5',
    name: 'Team Capacity Forecast',
    description: 'Project hires against open reqs to identify bottlenecks.',
    category: 'Team',
  },
  {
    id: 't-6',
    name: 'Interview-to-Offer Conversion',
    description: 'Drill into pass rates by stage, role, and interviewer.',
    category: 'Quality',
  },
]

export default function ReportsPage() {
  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Reports"
        description="Generate, schedule, and share hiring reports. The full report builder is in active development — the template catalogue below shows what we're shipping next."
        actions={
          <Button disabled>
            <MailIcon className="h-4 w-4" />
            Schedule report
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>What's available now</CardTitle>
          <CardDescription>For real-time numbers, head to Analytics.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <FileTextIcon className="h-5 w-5 flex-shrink-0 text-emerald-600" />
            <p className="text-sm text-emerald-900 dark:text-emerald-200">
              Live funnel, source, and team metrics are available now on the
              <span className="mx-1 font-semibold">Analytics</span>
              page — they read from your real data and refresh on every visit.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>
            Report templates we'll ship in a future release. The runner,
            scheduler, and PDF/CSV export are not implemented yet — Run,
            Schedule, Share, and Download are disabled until they are.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
            <ClockIcon className="h-5 w-5 flex-shrink-0 text-amber-600" />
            <p className="text-sm text-amber-900 dark:text-amber-200">
              We do not run, store, or deliver reports today. Anything you see
              in the "Recent" or "Scheduled" tabs would have been fake.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PLANNED_TEMPLATES.map(t => (
          <article
            key={t.id}
            className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800"
            aria-label={`${t.name} (coming soon)`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700/50">
                <FileTextIcon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                  CATEGORY_STYLES[t.category],
                )}
              >
                {t.category}
              </span>
            </div>

            <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-50">
              {t.name}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
              {t.description}
            </p>

            <div className="mt-4 flex flex-1 items-end justify-between border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-700/50 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <ClockIcon className="h-3 w-3" /> Coming soon
              </span>
              <Button size="sm" disabled aria-label={`Run ${t.name} (coming soon)`}>
                <PlayIcon className="h-3.5 w-3.5" />
                Run
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
