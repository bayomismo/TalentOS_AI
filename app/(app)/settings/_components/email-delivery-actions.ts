'use server'

/**
 * Sprint 19 — Email delivery administration (audit P0-03).
 *
 * Until now, an email sent by TalentOS vanished into the `EmailOutbox`
 * table: the provider was unconditionally the local outbox, the Resend
 * branch was commented out, and nothing ever drained the rows. An admin
 * asking "did the candidate get the interview invitation?" had no way to
 * find out.
 *
 * This action is the admin's window into that table. It answers three
 * questions honestly:
 *
 *   1. Is email actually being delivered, or only queued locally?
 *      (`configured` + `provider` — `isEmailDeliveryConfigured()`.)
 *   2. What happened to each send? The outbox row carries the provider
 *      that handled it (`provider`) and what that provider did with it
 *      (`deliveryStatus`: QUEUED | DELIVERED | FAILED).
 *   3. Where did it fail? The `failure` column carries the provider
 *      error.
 *
 * TENANT SCOPING
 *   `EmailOutbox` carries no `organizationId` — the row is a delivery
 *   log, not business data. The rows are therefore scoped through the
 *   foreign keys they reference: a send belongs to this organization when
 *   it is addressed to one of its users, or when its metadata points at
 *   one of its invitations / hiring requests. Sends that cannot be
 *   attributed to any tenant (for example a password reset for a user
 *   who has since left) are NOT shown.
 */

import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import { getEmailProviderName, isEmailDeliveryConfigured } from '@/lib/email'

export type EmailDeliveryStatus = {
  /** True when a REAL delivery provider is active. */
  configured: boolean
  /** 'resend' when configured, 'local-outbox' otherwise. */
  provider: 'resend' | 'local-outbox'
  /** A human-readable statement of what the current configuration means. */
  headline: string
  detail: string
  recent: Array<{
    id: string
    kind: string
    to: string
    subject: string
    /** The row's own lifecycle: PENDING | SENT | FAILED | SKIPPED. */
    status: string
    /** Which provider handled the send. */
    provider: string | null
    /** What the provider did: QUEUED | DELIVERED | FAILED. */
    deliveryStatus: string | null
    failure: string | null
    createdAt: string
  }>
}

export type EmailDeliveryActionFailure = {
  ok: false
  error: { code: string; message: string; retryable: boolean }
}

/** Reads a string out of a JSON metadata value. */
function metaString(meta: unknown, key: string): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const value = (meta as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

/**
 * The admin's email-delivery status: the live configuration plus the
 * sends that belong to this organization.
 */
export async function getEmailDeliveryStatusAction(): Promise<
  { ok: true; data: EmailDeliveryStatus } | EmailDeliveryActionFailure
> {
  const auth = await requirePermission('settings.manage')
  if (!auth.ok) return toActionFailure(auth)
  const organizationId = auth.data.organizationId

  // The foreign keys this tenant owns.
  const [users, invitations, hiringRequests] = await Promise.all([
    db.user.findMany({
      where: { organizationId },
      select: { email: true },
    }),
    db.invitation.findMany({
      where: { organizationId },
      select: { id: true },
    }),
    db.hiringRequest.findMany({
      where: { organizationId },
      select: { id: true },
    }),
  ])

  const userEmails = new Set(users.map((u) => u.email.toLowerCase()))
  const invitationIds = new Set(invitations.map((i) => i.id))
  const hiringRequestIds = new Set(hiringRequests.map((h) => h.id))

  // A bounded window of the delivery log, filtered down to this tenant.
  const rows = await db.emailOutbox.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      kind: true,
      to: true,
      subject: true,
      status: true,
      provider: true,
      deliveryStatus: true,
      failure: true,
      createdAt: true,
      metadata: true,
    },
  })

  const mine = rows.filter((row) => {
    if (userEmails.has(row.to.toLowerCase())) return true
    const invitationId = metaString(row.metadata, 'invitationId')
    if (invitationId && invitationIds.has(invitationId)) return true
    const hiringRequestId = metaString(row.metadata, 'hiringRequestId')
    if (hiringRequestId && hiringRequestIds.has(hiringRequestId)) return true
    return false
  })

  const configured = isEmailDeliveryConfigured()
  const provider = getEmailProviderName()

  return {
    ok: true,
    data: {
      configured,
      provider,
      headline: configured
        ? 'Email delivery is active.'
        : 'Email delivery is NOT active.',
      detail: configured
        ? `Messages are sent through ${provider}. Every send below records whether the provider accepted it.`
        : 'No delivery provider is configured, so every message is queued in the local outbox and nobody receives it. Set EMAIL_PROVIDER=resend and RESEND_API_KEY to start delivering mail.',
      recent: mine.slice(0, 25).map((row) => ({
        id: row.id,
        kind: row.kind,
        to: row.to,
        subject: row.subject,
        status: row.status,
        provider: row.provider,
        deliveryStatus: row.deliveryStatus,
        failure: row.failure,
        createdAt: row.createdAt.toISOString(),
      })),
    },
  }
}
