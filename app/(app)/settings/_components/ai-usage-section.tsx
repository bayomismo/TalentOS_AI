'use client'

/**
 * Sprint 16 — AI Usage meter for the Settings page.
 *
 * Shows the org's current monthly AI usage: total, per-feature breakdown,
 * the cap, the percent used, and when it resets. Read-only — the cap is
 * admin-controlled via Prisma Studio for now (no admin UI in Sprint 16).
 *
 * NOT a banner: just a section in /settings under "AI Usage". Per the
 * design call, the meter stays out of the user's way until they look.
 */

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'
import { SparklesIcon, AlertTriangleIcon, CheckCircle2Icon } from 'lucide-react'

interface UsageSummary {
  quota: number           // -1 = unlimited
  used: number
  percent: number | undefined
  resetAt: string
  byFeature: { feature: string; count: number }[]
}

const FEATURE_LABELS: Record<string, string> = {
  job_description: 'Job description generation',
  cv_analysis: 'CV analysis',
  candidate_ranking: 'Candidate ranking',
  interview_kit: 'Interview kit',
  decision_brief: 'Decision brief',
  offer_letter: 'Offer letter draft',
  copilot: 'AI Copilot',
  other: 'Other',
}

export function AiUsageSection() {
  const [data, setData] = useState<UsageSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/ai-usage')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled) return
        if (!d) {
          setError('Could not load usage')
          return
        }
        setData(d)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load usage')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const resetDate = data?.resetAt ? new Date(data.resetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="h-5 w-5 text-emerald-500" />
          AI Usage
        </CardTitle>
        <CardDescription>
          How many AI calls your team has made this billing cycle. Resets on the 1st of each month.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="h-24 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        )}
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}
        {data && !loading && data.quota === -1 && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/40">
            <CheckCircle2Icon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="font-medium text-emerald-900 dark:text-emerald-200">Unlimited AI</p>
              <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
                This workspace has an unlimited AI plan. No cap is applied.
              </p>
            </div>
          </div>
        )}
        {data && !loading && data.quota !== -1 && (
          <>
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                  {data.used.toLocaleString()}
                  <span className="ml-1 text-base font-normal text-slate-500 dark:text-slate-400">
                    / {data.quota.toLocaleString()}
                  </span>
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {data.percent !== undefined && data.percent >= 1
                    ? 'Limit reached'
                    : data.percent !== undefined && data.percent >= 0.8
                      ? 'Approaching limit'
                      : 'Healthy'}
                  {' · resets '}{resetDate}
                </p>
              </div>
              {data.percent !== undefined && data.percent >= 0.8 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  <AlertTriangleIcon className="h-3 w-3" />
                  {Math.round(data.percent * 100)}%
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className={
                  data.percent !== undefined && data.percent >= 1
                    ? 'h-full bg-rose-500 transition-all'
                    : data.percent !== undefined && data.percent >= 0.8
                      ? 'h-full bg-amber-500 transition-all'
                      : 'h-full bg-emerald-500 transition-all'
                }
                style={{ width: `${Math.min(100, (data.percent ?? 0) * 100)}%` }}
                aria-label={`${Math.round((data.percent ?? 0) * 100)}% of monthly AI quota used`}
              />
            </div>

            {data.byFeature.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  By feature
                </p>
                <div className="space-y-1.5">
                  {data.byFeature.slice(0, 8).map(({ feature, count }) => {
                    const pct = data.used > 0 ? (count / data.used) * 100 : 0
                    return (
                      <div key={feature} className="flex items-center gap-3">
                        <span className="w-40 shrink-0 truncate text-sm text-slate-700 dark:text-slate-300">
                          {FEATURE_LABELS[feature] ?? feature}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full bg-emerald-400/60"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-16 shrink-0 text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">
                          {count.toLocaleString()}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              Need more? Contact your administrator to raise the monthly cap, or bring your own AI provider in a future release.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
