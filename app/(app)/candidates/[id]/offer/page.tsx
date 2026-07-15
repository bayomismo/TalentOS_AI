'use client'

/**
 * Sprint 10 — Create Offer page (`/candidates/[id]/offer`).
 *
 * Pre-fills trusted data from the candidate + hiring request.
 * The form is gated server-side by:
 *   - `offer.create` permission
 *   - Candidate eligibility (Human Final Decision = SELECTED)
 *   - No active offer for the same candidate + hiring request
 *
 * Compensation values are entered by humans; AI does not generate
 * compensation. The optional AI letter generation is triggered
 * after the draft is saved (on the detail page) — not at creation
 * time, to keep create flow deterministic.
 */

import { use, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { ShieldAlertIcon, CheckIcon } from 'lucide-react'
import {
  createOfferAction,
  getCandidateEligibilityForOfferAction,
} from '@/features/offers/actions/offer-actions'
import { getSelectedHiringRequestForCandidateAction } from '@/features/offers/actions/eligibility-actions'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function CreateOfferPage({ params }: PageProps) {
  const router = useRouter()
  const { id: candidateId } = use(params)

  const [hiringRequestId, setHiringRequestId] = useState<string | null>(null)
  const [eligible, setEligible] = useState<boolean | null>(null)
  const [eligibilityReason, setEligibilityReason] = useState<string | null>(null)
  const [existingOfferId, setExistingOfferId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    title: '',
    salaryAmount: '',
    salaryCurrency: 'USD',
    salaryPeriod: 'annual',
    bonusAmount: '',
    equityAmount: '',
    commissionAmount: '',
    employmentType: 'FULL_TIME',
    workArrangement: 'ONSITE',
    startDate: '',
    expiresAt: '',
    probationPeriodDays: '',
    noticePeriodDays: '',
    vacationDays: '',
    benefits: '',
    additionalTerms: '',
  })

  // Discover the candidate's SELECTED decision and pull the HR ID from it
  useEffect(() => {
    startTransition(async () => {
      const r = await getSelectedHiringRequestForCandidateAction(candidateId)
      if (r.ok && r.data) {
        setHiringRequestId(r.data.hiringRequestId)
        if (r.data.title) setForm(f => ({ ...f, title: r.data!.title }))
      }
    })
  }, [candidateId])

  // Check eligibility once we have the HR
  useEffect(() => {
    if (!hiringRequestId) return
    startTransition(async () => {
      const r = await getCandidateEligibilityForOfferAction(candidateId, hiringRequestId)
      if (r.ok) {
        setEligible(r.data.eligible)
        setEligibilityReason(r.data.reason)
        setExistingOfferId(r.data.existingOfferId)
      }
    })
  }, [candidateId, hiringRequestId])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!hiringRequestId) {
      setError('No selected hiring request found for this candidate.')
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await createOfferAction({
      candidateId,
      hiringRequestId,
      title: form.title,
      salaryAmount: Number(form.salaryAmount),
      salaryCurrency: form.salaryCurrency,
      salaryPeriod: form.salaryPeriod,
      bonusAmount: form.bonusAmount ? Number(form.bonusAmount) : null,
      equityAmount: form.equityAmount || null,
      commissionAmount: form.commissionAmount ? Number(form.commissionAmount) : null,
      employmentType: form.employmentType,
      workArrangement: form.workArrangement,
      startDate: form.startDate ? new Date(form.startDate) : null,
      expiresAt: form.expiresAt ? new Date(form.expiresAt) : null,
      probationPeriodDays: form.probationPeriodDays ? Number(form.probationPeriodDays) : null,
      noticePeriodDays: form.noticePeriodDays ? Number(form.noticePeriodDays) : null,
      vacationDays: form.vacationDays ? Number(form.vacationDays) : null,
      benefits: form.benefits || null,
      additionalTerms: form.additionalTerms || null,
    })
    setSubmitting(false)
    if (result.ok) {
      router.push(`/offers/${result.data.id}`)
    } else {
      setError(result.error.message)
    }
  }

  if (eligible === false && existingOfferId) {
    return (
      <div className="space-y-4 p-8">
        <h1 className="text-2xl font-semibold">Create Offer</h1>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          {eligibilityReason ?? 'An active offer already exists for this candidate and hiring request.'}
        </div>
        <Button onClick={() => router.push(`/offers/${existingOfferId}`)}>View existing offer</Button>
      </div>
    )
  }
  if (eligible === false) {
    return (
      <div className="space-y-4 p-8">
        <h1 className="text-2xl font-semibold">Create Offer</h1>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          Candidate is not yet eligible for an offer: {eligibilityReason}
        </div>
        <Button variant="outline" onClick={() => router.back()}>Back</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-8">
      <div>
        <button onClick={() => router.back()} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">← Back</button>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">Create Offer</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          All compensation values are entered by you. The AI may draft the offer letter text but cannot change these numbers.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Position</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Job title" required value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} />
            <SelectField label="Employment type" value={form.employmentType} onChange={v => setForm(f => ({ ...f, employmentType: v }))}
              options={['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'].map(v => ({ value: v, label: v.replace('_', ' ') }))} />
            <SelectField label="Work arrangement" value={form.workArrangement} onChange={v => setForm(f => ({ ...f, workArrangement: v }))}
              options={['ONSITE', 'REMOTE', 'HYBRID'].map(v => ({ value: v, label: v }))} />
            <Field label="Proposed start date" type="date" value={form.startDate} onChange={v => setForm(f => ({ ...f, startDate: v }))} />
            <Field label="Offer expires" type="date" value={form.expiresAt} onChange={v => setForm(f => ({ ...f, expiresAt: v }))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Compensation</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Base salary" type="number" required value={form.salaryAmount} onChange={v => setForm(f => ({ ...f, salaryAmount: v }))} />
            <SelectField label="Currency" value={form.salaryCurrency} onChange={v => setForm(f => ({ ...f, salaryCurrency: v }))}
              options={['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'INR', 'OTHER'].map(v => ({ value: v, label: v }))} />
            <SelectField label="Salary period" value={form.salaryPeriod} onChange={v => setForm(f => ({ ...f, salaryPeriod: v }))}
              options={[{ value: 'annual', label: 'Annual' }, { value: 'monthly', label: 'Monthly' }, { value: 'hourly', label: 'Hourly' }]} />
            <Field label="Bonus (optional)" type="number" value={form.bonusAmount} onChange={v => setForm(f => ({ ...f, bonusAmount: v }))} />
            <Field label="Equity (optional, free-form)" placeholder="0.05% over 4 years" value={form.equityAmount} onChange={v => setForm(f => ({ ...f, equityAmount: v }))} />
            <Field label="Commission (optional)" type="number" value={form.commissionAmount} onChange={v => setForm(f => ({ ...f, commissionAmount: v }))} />
            <Field label="Vacation days (optional)" type="number" value={form.vacationDays} onChange={v => setForm(f => ({ ...f, vacationDays: v }))} />
            <Field label="Probation period days (optional)" type="number" value={form.probationPeriodDays} onChange={v => setForm(f => ({ ...f, probationPeriodDays: v }))} />
            <Field label="Notice period days (optional)" type="number" value={form.noticePeriodDays} onChange={v => setForm(f => ({ ...f, noticePeriodDays: v }))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Benefits & terms</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <TextArea label="Benefits" value={form.benefits} onChange={v => setForm(f => ({ ...f, benefits: v }))} placeholder="Health, dental, vision, 401k match, etc." />
            <TextArea label="Additional terms" value={form.additionalTerms} onChange={v => setForm(f => ({ ...f, additionalTerms: v }))} placeholder="Relocation, signing bonus, etc." />
          </CardContent>
        </Card>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
            <ShieldAlertIcon className="mt-0.5 h-4 w-4 flex-none" />
            <p>{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" disabled={submitting || !form.title || !form.salaryAmount}>
            {submitting ? 'Saving…' : 'Save draft'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, required }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}{required && <span className="ml-0.5 text-red-500">*</span>}</label>
      <input
        type={type} value={value} placeholder={placeholder} required={required}
        onChange={e => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50"
      />
    </div>
  )
}
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}
function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50" />
    </div>
  )
}
