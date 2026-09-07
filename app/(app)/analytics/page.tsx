'use client'

import { useEffect, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, TrendingUpIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getAnalyticsDataAction, type AnalyticsData } from './actions'

const RANGES = ['7d', '30d', '90d', 'YTD', 'All'] as const
type Range = (typeof RANGES)[number]

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>('30d')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getAnalyticsDataAction()
      .then(result => {
        if (cancelled) return
        setData(result)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load analytics')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const isEmpty = !!data && data.candidateCount === 0 && data.openRolesCount === 0

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        title="Analytics"
        description="Real-time insight into your hiring funnel. Compare ranges, watch trends, and make smarter talent decisions backed by your own data."
        actions={
          <>
            <Button variant="outline" disabled>
              <DownloadIcon className="h-4 w-4" />
              Export
            </Button>
            <Button disabled>Create report</Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <TrendingUpIcon className="h-4 w-4 text-emerald-500" />
          <span>Scope:</span>
          <span className="font-semibold text-slate-900 dark:text-slate-50">
            All time · this organization
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
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-50',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </CardContent>
        </Card>
      ) : loading || !data ? (
        <Card>
          <CardContent className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
            Loading analytics…
          </CardContent>
        </Card>
      ) : isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-center">
            <p className="text-base font-semibold text-slate-900 dark:text-slate-50">
              No data to analyze yet
            </p>
            <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
              Create your first hiring request and add candidates to start seeing real
              funnel, team, and source metrics here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="-mt-4 text-xs text-slate-500 dark:text-slate-400">
            {data.candidateCount} candidate{data.candidateCount === 1 ? '' : 's'} ·{' '}
            {data.offerCount} offer{data.offerCount === 1 ? '' : 's'} tracked
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.metrics.map(m => (
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
                          : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
                      )}
                    >
                      {m.trend === 'up' ? (
                        <ArrowUpIcon className="h-3 w-3" />
                      ) : (
                        <ArrowDownIcon className="h-3 w-3" />
                      )}
                      live
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
                    {m.value}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {m.helper}
                  </p>
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
                {data.funnel.map((stage, i) => (
                  <div key={stage.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {stage.label}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {stage.value}{' '}
                        <span className="text-xs">({stage.pct}%)</span>
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
                          i === 4 && 'bg-emerald-600',
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
                <CardDescription>
                  Distribution of closed roles, scoped to this organization.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.hiresByTeam.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No hires yet. Close a candidate to see team-level distribution.
                  </p>
                ) : (
                  data.hiresByTeam.map(t => (
                    <div key={t.team} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          {t.team}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {t.value}{' '}
                          <span className="text-xs">({t.pct}%)</span>
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/50">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${t.pct}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Where candidates come from</CardTitle>
              <CardDescription>
                Top sources by share of total candidates.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.sources.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No source data yet. Add candidates with a source to see this breakdown.
                </p>
              ) : (
                data.sources.map(s => (
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
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
