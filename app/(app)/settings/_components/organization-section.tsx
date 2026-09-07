'use client'

/**
 * Sprint 13 — Organization section.
 *
 * Reads the authenticated tenant's organization and lets ADMIN
 * update name, industry, size, country, timezone, website, and
 * description. NEVER reads an organizationId from the browser.
 */

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckIcon, Loader2Icon, AlertCircleIcon, ExternalLinkIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { getOwnOrganizationAction, updateOwnOrganizationAction } from '@/lib/onboarding/actions'

const INDUSTRIES = [
  'SaaS', 'E-commerce', 'Fintech', 'Healthcare', 'Education',
  'Manufacturing', 'Retail', 'Media & Entertainment',
  'Professional Services', 'Government', 'Non-profit', 'Other',
]

const SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001+']

export function OrganizationSection() {
  const router = useRouter()
  const [org, setOrg] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [size, setSize] = useState('')
  const [country, setCountry] = useState('')
  const [timezone, setTimezone] = useState('')
  const [website, setWebsite] = useState('')
  const [description, setDescription] = useState('')
  const [pending, startTransition] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getOwnOrganizationAction()
      .then(r => {
        if (r.ok && r.data) {
          setOrg(r.data)
          setName(r.data.name)
          setIndustry(r.data.industry ?? '')
          setSize(r.data.size ?? '')
          setCountry(r.data.country ?? '')
          setTimezone(r.data.timezone ?? '')
          setWebsite(r.data.website ?? '')
          setDescription(r.data.description ?? '')
        } else {
          setError(r.error?.message ?? 'Failed to load organization.')
        }
      })
      .finally(() => setLoading(false))
  }, [])

  function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r = await updateOwnOrganizationAction({
        name: name.trim(),
        industry: industry || null,
        size: size || null,
        country: country || null,
        timezone: timezone || null,
        website: website || null,
        description: description || null,
      })
      if (!r.ok) { setError(r.error?.message ?? 'Failed to save.'); return }
      setSavedAt(Date.now())
      // Refresh the data
      const fresh = await getOwnOrganizationAction()
      if (fresh.ok && fresh.data) setOrg(fresh.data)
      router.refresh()
    })
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-slate-500">
          <Loader2Icon className="h-4 w-4 animate-spin" /> Loading organization…
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>
            These details describe your workspace. Team members see the name and logo across TalentOS.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
              <AlertCircleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField id="orgName" label="Organization name" value={name} onChange={setName} required maxLength={80} />
              <ReadOnlyField id="orgSlug" label="Workspace URL" value={`talentos-ai-lime.vercel.app/${org?.slug ?? ''}`} />
              <SelectField id="orgIndustry" label="Industry" value={industry} onChange={setIndustry} options={INDUSTRIES.map(i => ({ value: i, label: i }))} />
              <SelectField id="orgSize" label="Company size" value={size} onChange={setSize} options={SIZES.map(s => ({ value: s, label: s }))} />
              <TextField id="orgCountry" label="Country" value={country} onChange={setCountry} maxLength={80} />
              <TextField id="orgTz" label="Time zone" value={timezone} onChange={setTimezone} maxLength={80} placeholder="America/New_York" />
              <TextField id="orgWebsite" label="Website" value={website} onChange={setWebsite} maxLength={200} placeholder="https://yourcompany.com" />
            </div>

            <div>
              <label htmlFor="orgDesc" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
              <textarea
                id="orgDesc"
                value={description}
                onChange={e => setDescription(e.target.value)}
                maxLength={2000}
                rows={3}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
                placeholder="What does your company do?"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                {savedAt && (
                  <p className="flex items-center gap-1 text-xs text-emerald-600">
                    <CheckIcon className="h-3 w-3" /> Saved.
                  </p>
                )}
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? <><Loader2Icon className="h-4 w-4 animate-spin" /> Saving…</> : 'Save changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {org && (
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>Live counts for your workspace. Reset from Data Management.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Users" value={org.counts.users} />
              <Stat label="Departments" value={org.counts.departments} />
              <Stat label="Hiring requests" value={org.counts.hiringRequests} />
              <Stat label="Candidates" value={org.counts.candidates} />
              <Stat label="Interviews" value={org.counts.interviews} />
              <Stat label="Offers" value={org.counts.offers} />
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Workspace created {new Date(org.createdAt).toLocaleDateString()}.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function TextField({ id, label, value, onChange, required, maxLength, readOnly, placeholder }: {
  id: string; label: string; value: string; onChange?: (v: string) => void;
  required?: boolean; maxLength?: number; readOnly?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={e => onChange?.(e.target.value)}
        required={required}
        maxLength={maxLength}
        readOnly={readOnly}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50 read-only:bg-slate-50 read-only:text-slate-500 dark:read-only:bg-slate-800"
      />
    </div>
  )
}

function ReadOnlyField({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <div className="mt-1 flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        <span className="truncate">{value}</span>
        <ExternalLinkIcon className="h-3 w-3 flex-shrink-0" />
      </div>
    </div>
  )
}

function SelectField({ id, label, value, onChange, options }: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50"
      >
        <option value="">Select…</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{value}</dd>
    </div>
  )
}
