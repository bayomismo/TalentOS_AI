'use client'

/**
 * Sprint 19 — Offer audit log (`/offers/audit`).
 *
 * Audit P1-14 — the AuditLog table was write-only: every offer change
 * wrote a row and NOTHING could read it back. This is the reader.
 *
 * The organization-wide route lives at `/audit`; this offer-scoped route
 * is the same view, reachable from the offers area.
 */

import { PageHeader } from '@/components/shared/page-header'
import { OfferAuditLogView } from '@/features/offers/components/offer-audit-log-view'

export default function OfferAuditLogPage() {
  return (
    <>
      <div className="p-8 pb-0">
        <PageHeader
          title="Offer audit log"
          description="Every offer change is recorded with who did it and what changed. Compensation metadata is only shown to roles with compensation access."
        />
      </div>
      <OfferAuditLogView backHref="/offers" />
    </>
  )
}
