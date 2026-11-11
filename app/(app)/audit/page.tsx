'use client'

/**
 * Sprint 19 — Organization audit log (`/audit`).
 *
 * Audit P1-14 — the AuditLog table had no reader anywhere in the
 * product. This is the organization-wide route (the plan asks for a
 * new `/audit` route; the offer-scoped view at `/offers/audit` renders
 * the same component).
 *
 * Access: `audit.view` (ADMIN / TA_LEAD). The action layer scopes every
 * row to the caller's organization and strips compensation-bearing
 * metadata for callers without `offer.view_compensation`.
 */

import { PageHeader } from '@/components/shared/page-header'
import { OfferAuditLogView } from '@/features/offers/components/offer-audit-log-view'

export default function AuditLogPage() {
  return (
    <>
      <div className="p-8 pb-0">
        <PageHeader
          title="Audit log"
          description="Who did what, when — and what changed. Every offer and candidate decision is recorded here as it happens."
        />
      </div>
      <OfferAuditLogView backHref="/dashboard" />
    </>
  )
}
