'use client'

import { useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, TrendingUpIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const RANGES = ['7d', '30d', '90d', 'YTD', 'All'] as const
type Range = (typeof RANGES)[number]

interface MetricCard {
  label: string
  value: string
  change: number
  trend: 'up' | 'down'
  helper: string
}

const KEY_METRICS: MetricCard[] = [
  { label: 'Time to hire', value: '23 days', change: -8, trend: 'up', helper: 'vs. last 30 days' },
  { label: 'Offer acceptance', value: '92%', change: 4, trend: 'up', helper: 'vs. last 30 days' },
  { label: 'Pipeline velocity', value: '12.4', change: 9, trend: 'up', helper: 'candidates per role' },
  { label: 'Source quality', value: '3.8x', change: -2, trend: 'down', helper: 'qualified per application' },
  { label: 'Interview-to-offer', value: '38%', change: 6, trend: 'up', helper: 'vs. last 30 days' },
  { label: 'Cost per hire', value: '$3,210', change: -11, trend: 'up', helper: 'vs. last 30 days' },
]

const PIPELINE_FUNNEL = [
  { label: 'Applied', value: 412, pct: 100 },
  { label: 'Screened', value: 264, pct: 64 },
  { label: 'Interviewed', value: 132, pct: 32 },
  { label: 'Offered', value: 41, pct: 10 },
  { label: 'Hired', value: 18, pct: 4 },
]

const HIRES_BY_TEAM = [
  { team: 'Engineering', value: 8, pct: 44 },
  { team: 'Product', value: 3, pct: 17 },
  { team: 'Design', value: 4, pct: 22 },
  { team: 'Data', value: 2, pct: 11 },
  { team: 'Operations', value: 1, pct: 6 },
]

const SOURCES = [
  { name: 'Referrals', share: 38, color: 'bg-emerald-500' },
  { name: 'LinkedIn', share: 24, color: 'bg-blue-500' },
  { name: 'Company site', share: 18, color: 'bg-violet-500' },
  { name: 'AngelList', share: 12, color: 'bg-amber-500' },
  { name: 'Other', share: 8, color: 'bg-slate-400' },
]

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>('30d')

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Analytics"
        description="Real-time insight into your hiring funnel. Compare ranges, watch trends, and make smarter talent decisions backed by your own data."
        actions={
          <>
            <Button variant="outline">
              <DownloadIcon className="h-4 w-4" />
              Export
            </Button>
            <Button>Create report</Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <TrendingUpIcon className="h-4 w-4 text-emerald-500" />
          <span>Time range:</span>
          <span className="font-semibold text-slate-900 dark:text-slate-50">
            {range === '7d' ? 'Last 7 days' : range === '30d' ? 'Last 30 days' : range === '90d' ? 'Last 90 days' : range === 'YTD' ? 'Year to date' : 'All time'}
          </span>
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-900">
          {RANGES.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                range === r
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-50'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-50'
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {KEY_METRICS.map(m => (
          <Card key={m.label}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                  {m.label}
                </p>
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold',
                    m.trend === 'up'
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                  )}
                >
                  {m.trend === 'up' ? (
                    <ArrowUpIcon className="h-3 w-3" />
                  ) : (
                    <ArrowDownIcon className="h-3 w-3" />
                  )}
                  {Math.abs(m.change)}%
                </span>
              </div>
              <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
                {m.value}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{m.helper}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Hiring funnel</CardTitle>
            <CardDescription>
              How candidates move through each stage of your pipeline.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {PIPELINE_FUNNEL.map((stage, i) => (
              <div key={stage.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {stage.label}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {stage.value} <span className="text-xs">({stage.pct}%)</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/50">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      i === 0 && 'bg-emerald-500',
                      i === 1 && 'bg-emerald-400',
                      i === 2 && 'bg-emerald-300',
                      i === 3 && 'bg-amber-400',
                      i === 4 && 'bg-emerald-600'
                    )}
                    style={{ width: `${stage.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hires by team</CardTitle>
            <CardDescription>Distribution of closed roles this period.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {HIRES_BY_TEAM.map(t => (
              <div key={t.team} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {t.team}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {t.value} <span className="text-xs">({t.pct}%)</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/50">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${t.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Where candidates come from</CardTitle>
          <CardDescription>
            Top sources by share of qualified applicants.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {SOURCES.map(s => (
            <div key={s.name} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {s.name}
                </span>
                <span className="font-semibold text-slate-900 dark:text-slate-50">
                  {s.share}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/50">
                <div
                  className={cn('h-full rounded-full', s.color)}
                  style={{ width: `${s.share}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
