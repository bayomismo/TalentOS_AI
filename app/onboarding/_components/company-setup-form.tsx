'use client'

import { useState, useTransition } from 'react'
import { AlertCircleIcon, Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { companySetupAction } from '@/lib/onboarding/actions'

interface Defaults {
  industry: string
  size: string
  country: string
  timezone: string
}

export function CompanySetupForm({ defaults }: { defaults: Defaults }) {
  const [industry, setIndustry] = useState(defaults.industry)
  const [size, setSize] = useState(defaults.size)
  const [country, setCountry] = useState(defaults.country)
  const [timezone, setTimezone] = useState(defaults.timezone)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r = await companySetupAction({
        industry: industry || null,
        size: size || null,
        country: country || null,
        timezone: timezone || null,
      })
      if (!r.ok) { setError(r.error?.message ?? 'Failed to save.'); return }
      window.location.href = '/onboarding/team'
    })
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          <AlertCircleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="industry" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Industry</label>
          <select
            id="industry"
            value={industry}
            onChange={e => setIndustry(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
          >
            <option value="">Select…</option>
            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="size" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Company size</label>
          <select
            id="size"
            value={size}
            onChange={e => setSize(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
          >
            <option value="">Select…</option>
            <option value="1-10">1–10</option>
            <option value="11-50">11–50</option>
            <option value="51-200">51–200</option>
            <option value="201-500">201–500</option>
            <option value="501-1000">501–1,000</option>
            <option value="1001+">1,001+</option>
          </select>
        </div>
        <div>
          <label htmlFor="country" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Country</label>
          <input
            id="country"
            type="text"
            value={country}
            onChange={e => setCountry(e.target.value)}
            placeholder="United States"
            className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
          />
        </div>
        <div>
          <label htmlFor="tz" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Time zone</label>
          <input
            id="tz"
            type="text"
            value={timezone}
            onChange={e => setTimezone(e.target.value)}
            placeholder="America/New_York"
            className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
          />
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <><Loader2Icon className="h-4 w-4 animate-spin" /> Saving…</> : 'Continue'}
        </Button>
      </div>
    </form>
  )
}

const INDUSTRIES = [
  'SaaS',
  'E-commerce',
  'Fintech',
  'Healthcare',
  'Education',
  'Manufacturing',
  'Retail',
  'Media & Entertainment',
  'Professional Services',
  'Government',
  'Non-profit',
  'Other',
]
