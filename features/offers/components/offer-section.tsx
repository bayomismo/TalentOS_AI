'use client'

/**
 * Sprint 10 — Offer section on Candidate Detail.
 *
 * Shows:
 *   - "Not yet eligible" if no human SELECTED decision
 *   - "Eligible for offer" CTA if SELECTED and no offer
 *   - Existing offer summary (status + dates + compensation only if authorized)
 *
 * Compensation fields are gated server-side via the same
 * `offer.view_compensation` permission used elsewhere.
 */

import { useEffect, useState, useTransition } from 'react'

import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shared/card'
import { Button } from '@/components/ui/button'
import { BriefcaseIcon, CheckCircle2Icon, ShieldAlertIcon } from 'lucide-react'
import { OfferStatusBadge } from './offer-status-badge'
import { getCandidateEligibilityForOfferAction, getOfferDetailAction } from '@/features/offers/actions/offer-actions'

interface Props {
  candidateId: string
}

export function OfferSection({ candidateId }: Props) {
  const router = useRouter()
  const [eligible, setEligible] = useState<boolean | null>(null)
  const [eligibilityReason, setEligibilityReason] = useState<string | null>(null)
  const [existingOfferId, setExistingOfferId] = useState<string | null>(null)
  const [offerStatus, setOfferStatus] = useState<string | null>(null)
  const [offerCompensation, setOfferCompensation] = useState<{ amount: number; currency: string; period: string } | null>(null)
  const [offerStartDate, setOfferStartDate] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      // First, query eligibility for any SELECTED HR
      const r = await getCandidateEligibilityForOfferAction(candidateId, '__any__')
        .catch(() => null)
      // The helper expects a specific HR; the create page uses the SELECTED HR.
      // For the candidate detail we instead directly call a server action that
      // returns all SELECTED HRs and any active offer.
      const el = await fetchEligibilityForCandidate(candidateId)
      if (el) {
        setEligible(el.eligible)
        setEligibilityReason(el.reason)
        setExistingOfferId(el.existingOfferId)
        if (el.existingOfferId) {
          const d = await getOfferDetailAction(el.existingOfferId)
          if (d.ok) {
            setOfferStatus(d.data.status)
            if (d.data.salaryAmount != null) {
              setOfferCompensation({
                amount: d.data.salaryAmount,
                currency: d.data.salaryCurrency!,
                period: d.data.salaryPeriod!,
              })
            }
            setOfferStartDate(d.data.startDate)
          }
        }
      }
    })
  }, [candidateId])

  if (pending) {
    return (
      <Card>
        <CardHeader><CardTitle>Offer</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-slate-500">Loading…</p></CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BriefcaseIcon className="h-4 w-4 text-slate-500" />
          Offer
        </CardTitle>
      </CardHeader>
      <CardContent>
        {eligible === null ? (
          <p className="text-sm text-slate-500">Candidate is not yet eligible for an offer.</p>
        ) : eligible === false && !existingOfferId ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">{eligibilityReason ?? 'Candidate is not yet eligible for an offer.'}</p>
            <p className="text-xs text-slate-400">A human final decision of SELECTED is required before an offer can be created.</p>
          </div>
        ) : existingOfferId ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2Icon className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50">Offer exists</p>
              {offerStatus && <OfferStatusBadge status={offerStatus} />}
            </div>
            {offerCompensation && (
              <p className="text-sm text-slate-700 dark:text-slate-200">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: offerCompensation.currency, maximumFractionDigits: 0 }).format(offerCompensation.amount)}{' '}
                / {offerCompensation.period}
              </p>
            )}
            {!offerCompensation && (
              <p className="text-xs text-slate-400">Compensation restricted</p>
            )}
            {offerStartDate && (
              <p className="text-xs text-slate-500">Start: {new Date(offerStartDate).toLocaleDateString()}</p>
            )}
            <Button size="sm" variant="outline" onClick={() => router.push(`/offers/${existingOfferId}`)}>View offer</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Eligible for offer</p>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => router.push(`/candidates/${candidateId}/offer`)}>
              <BriefcaseIcon className="mr-1.5 h-3 w-3" /> Create offer
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Server-side fetch helper via a server action (kept inline to avoid an extra file)
async function fetchEligibilityForCandidate(candidateId: string): Promise<{
  eligible: boolean
  reason: string | null
  existingOfferId: string | null
} | null> {
  // Use the existing listOffersAction to look up offers for this candidate
  const { listOffersAction } = await import('@/features/offers/actions/offer-actions')
  const r = await listOffersAction({ candidateId })
  if (!r.ok) return null
  const active = r.data.offers.find(o => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'ACCEPTED'].includes(o.status))
  // We still need to know if the candidate is eligible. Use the SELECTED-HR helper.
  const { getSelectedHiringRequestForCandidateAction } = await import('@/features/offers/actions/eligibility-actions')
  const sel = await getSelectedHiringRequestForCandidateAction(candidateId)
  if (!sel.ok || !sel.data) {
    return { eligible: false, reason: 'No human SELECTED decision recorded.', existingOfferId: active?.id ?? null }
  }
  // Re-check eligibility for the SELECTED HR specifically
  const { getCandidateEligibilityForOfferAction } = await import('@/features/offers/actions/offer-actions')
  const e = await getCandidateEligibilityForOfferAction(candidateId, sel.data.hiringRequestId)
  if (!e.ok) return { eligible: false, reason: e.error.message, existingOfferId: active?.id ?? null }
  return {
    eligible: e.data.eligible,
    reason: e.data.reason,
    existingOfferId: e.data.existingOfferId ?? active?.id ?? null,
  }
}
