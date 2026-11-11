'use server'

/**
 * Sprint 10 / 19 — Offer server actions.
 *
 * Thin wrappers over `features/offers/services/offer-service.ts`.
 * Every action calls `requireAuth()` + `requirePermission()` and
 * resolves the offer by ID with tenant isolation enforced.
 *
 * Response shape mirrors the existing `ActionResult<T>` used across
 * the codebase. Compensation fields are NEVER included in responses
 * to callers that lack `offer.view_compensation`.
 *
 * SPRINT 19 CHANGES
 *   P1-01  The offer letter (whose prose states the salary) is only
 *          returned to a caller with `offer.view_compensation`.
 *   P1-02  "Return for changes" and "cancel draft" are real actions.
 *   P1-03  An APPROVED offer can be withdrawn.
 *   P1-04  An offer can be expired, and the metrics use a meaningful
 *          acceptance-rate denominator.
 *   P1-14  The audit trail is READABLE — the offer audit log.
 */

import 'server-only'
import { requireAuth, requirePermission } from '@/lib/auth/authorize'
import { hasPermission } from '@/lib/auth/permissions'
import { toActionFailure } from '@/lib/auth/adapter'
import type { ActionResult } from '@/lib/auth/action-helpers'
import { safeRevalidate } from '@/lib/utils/revalidate'
import { expireStaleOffers } from '@/lib/offers/expiry'
import { db } from '@/lib/db'
import type { Offer, OfferStatus } from '@prisma/client'
import {
  createOffer as svcCreateOffer,
  editOffer as svcEditOffer,
  submitOfferForApproval,
  returnOfferForChanges,
  approveOffer,
  issueOffer,
  recordOfferResponse,
  generateOfferDraft,
  setOfferDraftContent,
  getOffer,
  withdrawOffer,
  expireOffer,
  cancelDraftOffer,
  type ServiceResult,
  type CreateOfferInput,
  type EditOfferInput,
} from '@/features/offers/services/offer-service'

function toAction<T>(r: ServiceResult<T>): ActionResult<T> {
  if (r.ok) return { ok: true, data: r.data }
  return { ok: false, error: { code: r.code, message: r.message, ...(r.meta ? { meta: r.meta } : {}) } }
}

interface Ctx {
  userId: string
  organizationId: string
  role: string
  isAdmin: boolean
  isTaLead: boolean
}

async function resolveCtx(): Promise<{ ok: true; ctx: Ctx } | { ok: false; result: ActionResult<never> }> {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false, result: toActionFailure(auth) }
  const ctx: Ctx = {
    userId: auth.data.userId,
    organizationId: auth.data.organizationId,
    role: auth.data.role,
    isAdmin: auth.data.isAdmin,
    isTaLead: auth.data.role === 'TA_LEAD',
  }
  return { ok: true, ctx }
}

async function requireOfferView(): Promise<{ ok: true; ctx: Ctx; canComp: boolean } | { ok: false; result: ActionResult<never> }> {
  const r = await resolveCtx()
  if (!r.ok) return r
  const auth = await requirePermission('offer.view')
  if (!auth.ok) return { ok: false, result: toActionFailure(auth) }
  return { ok: true, ctx: r.ctx, canComp: hasPermission(r.ctx.role as never, 'offer.view_compensation') }
}

// -----------------------------------------------------------------------------
// Read paths
// -----------------------------------------------------------------------------

export interface OfferListItem {
  id: string
  status: OfferStatus
  title: string
  candidateId: string
  candidateName: string
  hiringRequestId: string
  hiringRequestTitle: string
  createdAt: string
  updatedAt: string
  expiresAt: string | null
  createdByName: string | null
  /** Set when a newer offer replaced this one (audit P2-29). */
  supersededAt: string | null
  /** Compensation ONLY when caller has offer.view_compensation */
  salaryAmount?: number
  salaryCurrency?: string
  salaryPeriod?: string
}

export interface OfferDetail {
  id: string
  status: OfferStatus
  title: string
  organizationId: string
  candidateId: string
  candidateName: string
  candidateEmail: string
  hiringRequestId: string
  hiringRequestTitle: string
  department: string | null
  employmentType: string | null
  workArrangement: string | null
  startDate: string | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
  approvedAt: string | null
  approvedByName: string | null
  issuedAt: string | null
  issuedByName: string | null
  acceptedAt: string | null
  declinedAt: string | null
  declineReason: string | null
  withdrawnAt: string | null
  withdrawnReason: string | null
  expiredAt: string | null
  notes: string | null
  benefits: string | null
  additionalTerms: string | null
  /**
   * The offer letter. ONLY populated for a caller with
   * `offer.view_compensation` — the letter states the salary in prose,
   * so handing it to a role without that permission leaks the
   * compensation the column-level gate protects (audit P1-01).
   */
  draftContent?: unknown | null
  aiGeneratedAt: string | null
  aiPromptVersion: string | null
  aiModelUsed: string | null
  selfApproved: boolean
  supersededAt: string | null
  /** Compensation ONLY when caller has offer.view_compensation */
  salaryAmount?: number
  salaryCurrency?: string
  salaryPeriod?: string
  bonusAmount?: number | null
  equityAmount?: string | null
  commissionAmount?: number | null
  vacationDays?: number | null
  probationPeriodDays?: number | null
  noticePeriodDays?: number | null
}

/**
 * Lists offers for the caller's organization with the fields appropriate
 * to the caller's permission set. If the caller lacks
 * `offer.view_compensation`, salary is omitted.
 */
export async function listOffersAction(filters: { status?: string; hiringRequestId?: string; candidateId?: string } = {}): Promise<ActionResult<{ offers: OfferListItem[]; total: number }>> {
  const r = await requireOfferView()
  if (!r.ok) return r.result
  // Audit P1-04 — lazy expiry backstop: an offer whose expiry date has
  // passed is expired when the list is read, so it never stays ISSUED
  // forever. Best-effort: a failure here must not break the list.
  await expireStaleOffers(r.ctx.organizationId, { limit: 25 }).catch(() => null)
  const where: any = { organizationId: r.ctx.organizationId }
  if (filters.status) where.status = filters.status as OfferStatus
  if (filters.hiringRequestId) where.hiringRequestId = filters.hiringRequestId
  if (filters.candidateId) where.candidateId = filters.candidateId
  const offers = await db.offer.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }],
    take: 200,
    include: {
      candidate: { select: { firstName: true, lastName: true } },
      hiringRequest: { select: { title: true } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
  })
  const items: OfferListItem[] = offers.map(o => {
    const base: OfferListItem = {
      id: o.id,
      status: o.status,
      title: o.title,
      candidateId: o.candidateId,
      candidateName: `${o.candidate.firstName} ${o.candidate.lastName}`.trim(),
      hiringRequestId: o.hiringRequestId,
      hiringRequestTitle: o.hiringRequest.title,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      expiresAt: o.expiresAt?.toISOString() ?? null,
      createdByName: o.createdBy ? `${o.createdBy.firstName} ${o.createdBy.lastName}`.trim() : null,
      supersededAt: o.supersededAt?.toISOString() ?? null,
    }
    if (r.canComp) {
      base.salaryAmount = o.salaryAmount
      base.salaryCurrency = o.salaryCurrency
      base.salaryPeriod = o.salaryPeriod
    }
    return base
  })
  return { ok: true, data: { offers: items, total: items.length } }
}

export async function getOfferDetailAction(offerId: string): Promise<ActionResult<OfferDetail>> {
  const r = await requireOfferView()
  if (!r.ok) return r.result
  // Audit P1-04 — lazy expiry backstop (see listOffersAction).
  await expireStaleOffers(r.ctx.organizationId, { limit: 25 }).catch(() => null)
  const offer = await db.offer.findFirst({
    where: { id: offerId, organizationId: r.ctx.organizationId },
    include: {
      candidate: { select: { firstName: true, lastName: true, email: true } },
      hiringRequest: { select: { title: true, department: { select: { name: true } } } },
      createdBy: { select: { firstName: true, lastName: true } },
      approvedBy: { select: { firstName: true, lastName: true } },
      issuedBy: { select: { firstName: true, lastName: true } },
    },
  })
  if (!offer) return { ok: false, error: { code: 'OFFER_NOT_FOUND', message: 'Offer not found.' } }
  const selfApproved =
    !!offer.approvedById &&
    !!offer.createdById &&
    offer.approvedById === offer.createdById
  const detail: OfferDetail = {
    id: offer.id,
    status: offer.status,
    title: offer.title,
    organizationId: offer.organizationId,
    candidateId: offer.candidateId,
    candidateName: `${offer.candidate.firstName} ${offer.candidate.lastName}`.trim(),
    candidateEmail: offer.candidate.email,
    hiringRequestId: offer.hiringRequestId,
    hiringRequestTitle: offer.hiringRequest.title,
    department: offer.hiringRequest.department?.name ?? null,
    employmentType: offer.employmentType,
    workArrangement: offer.workArrangement,
    startDate: offer.startDate?.toISOString() ?? null,
    expiresAt: offer.expiresAt?.toISOString() ?? null,
    createdAt: offer.createdAt.toISOString(),
    updatedAt: offer.updatedAt.toISOString(),
    approvedAt: offer.approvedAt?.toISOString() ?? null,
    approvedByName: offer.approvedBy ? `${offer.approvedBy.firstName} ${offer.approvedBy.lastName}`.trim() : null,
    issuedAt: offer.issuedAt?.toISOString() ?? null,
    issuedByName: offer.issuedBy ? `${offer.issuedBy.firstName} ${offer.issuedBy.lastName}`.trim() : null,
    acceptedAt: offer.acceptedAt?.toISOString() ?? null,
    declinedAt: offer.declinedAt?.toISOString() ?? null,
    declineReason: offer.declineReason,
    withdrawnAt: offer.withdrawnAt?.toISOString() ?? null,
    withdrawnReason: offer.withdrawnReason,
    expiredAt: offer.expiredAt?.toISOString() ?? null,
    notes: offer.notes,
    benefits: offer.benefits,
    additionalTerms: offer.additionalTerms,
    aiGeneratedAt: offer.aiGeneratedAt?.toISOString() ?? null,
    aiPromptVersion: offer.aiPromptVersion,
    aiModelUsed: offer.aiModelUsed,
    selfApproved,
    supersededAt: offer.supersededAt?.toISOString() ?? null,
  }
  // Audit P1-01 — the letter states the compensation in prose, so it is
  // part of the compensation surface: it is only returned to a caller
  // with `offer.view_compensation`.
  if (r.canComp) {
    detail.draftContent = offer.draftContent
    detail.salaryAmount = offer.salaryAmount
    detail.salaryCurrency = offer.salaryCurrency
    detail.salaryPeriod = offer.salaryPeriod
    detail.bonusAmount = offer.bonusAmount
    detail.equityAmount = offer.equityAmount
    detail.commissionAmount = offer.commissionAmount
    detail.vacationDays = offer.vacationDays
    detail.probationPeriodDays = offer.probationPeriodDays
    detail.noticePeriodDays = offer.noticePeriodDays
  } else {
    detail.draftContent = null
  }
  return { ok: true, data: detail }
}

export async function getOfferActivityAction(offerId: string): Promise<ActionResult<Array<{
  id: string
  type: string
  title: string
  description: string | null
  actorName: string | null
  occurredAt: string
  metadata: Record<string, unknown>
}>>> {
  const r = await requireOfferView()
  if (!r.ok) return r.result
  const offer = await db.offer.findFirst({ where: { id: offerId, organizationId: r.ctx.organizationId }, select: { id: true } })
  if (!offer) return { ok: false, error: { code: 'OFFER_NOT_FOUND', message: 'Offer not found.' } }
  const acts = await db.activity.findMany({
    where: { offerId, organizationId: r.ctx.organizationId },
    orderBy: { occurredAt: 'desc' },
    include: { actor: { select: { firstName: true, lastName: true } } },
  })
  // PART 23: strip compensation from activity metadata before returning
  return {
    ok: true,
    data: acts.map(a => {
      const meta = (a.metadata ?? {}) as Record<string, unknown>
      // Never echo compensation-related fields via activity feed
      const { salaryAmount: _s, salaryCurrency: _sc, salaryPeriod: _sp, bonusAmount: _b, ...safeMeta } = meta as any
      return {
        id: a.id,
        type: a.type,
        title: a.title,
        description: a.description,
        actorName: a.actor ? `${a.actor.firstName} ${a.actor.lastName}`.trim() : null,
        occurredAt: a.occurredAt.toISOString(),
        metadata: safeMeta,
      }
    }),
  }
}

// -----------------------------------------------------------------------------
// Audit trail (audit P1-14 — the audit log was write-only)
// -----------------------------------------------------------------------------

export interface OfferAuditEntry {
  id: string
  action: string
  outcome: string
  reason: string | null
  targetType: string | null
  targetId: string | null
  actorName: string | null
  occurredAt: string
  metadata: Record<string, unknown>
}

/**
 * The offer's own audit trail. Audit P1-14: `audit.view` existed and
 * AuditLog rows were written, but NOTHING could read them back — the
 * table was a write-only ledger.
 */
export async function getOfferAuditTrailAction(offerId: string): Promise<ActionResult<OfferAuditEntry[]>> {
  const r = await requireOfferView()
  if (!r.ok) return r.result
  const offer = await db.offer.findFirst({
    where: { id: offerId, organizationId: r.ctx.organizationId },
    select: { id: true },
  })
  if (!offer) return { ok: false, error: { code: 'OFFER_NOT_FOUND', message: 'Offer not found.' } }
  const rows = await db.auditLog.findMany({
    where: { organizationId: r.ctx.organizationId, targetType: 'offer', targetId: offerId },
    orderBy: { occurredAt: 'desc' },
    take: 200,
    include: { actor: { select: { firstName: true, lastName: true } } },
  })
  return {
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      action: row.action,
      outcome: row.outcome,
      reason: row.reason,
      targetType: row.targetType,
      targetId: row.targetId,
      actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}`.trim() : null,
      occurredAt: row.occurredAt.toISOString(),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    })),
  }
}

/**
 * The organization-wide offer audit log. Requires `audit.view`.
 * Compensation-bearing metadata is stripped for callers without
 * `offer.view_compensation`.
 */
export async function getOrgOfferAuditLogAction(
  filters: { limit?: number; action?: string } = {},
): Promise<ActionResult<OfferAuditEntry[]>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('audit.view')
  if (!auth.ok) return toActionFailure(auth)
  const canComp = hasPermission(r.ctx.role as never, 'offer.view_compensation')
  const rows = await db.auditLog.findMany({
    where: {
      organizationId: r.ctx.organizationId,
      ...(filters.action ? { action: filters.action } : {}),
    },
    orderBy: { occurredAt: 'desc' },
    take: Math.min(Math.max(filters.limit ?? 100, 1), 500),
    include: { actor: { select: { firstName: true, lastName: true } } },
  })
  return {
    ok: true,
    data: rows.map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>
      const { salaryAmount: _s, salaryCurrency: _sc, salaryPeriod: _sp, bonusAmount: _b, ...safeMeta } = meta as any
      return {
        id: row.id,
        action: row.action,
        outcome: row.outcome,
        reason: row.reason,
        targetType: row.targetType,
        targetId: row.targetId,
        actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}`.trim() : null,
        occurredAt: row.occurredAt.toISOString(),
        metadata: canComp ? (safeMeta as Record<string, unknown>) : (safeMeta as Record<string, unknown>),
      }
    }),
  }
}

// -----------------------------------------------------------------------------
// Mutations
// -----------------------------------------------------------------------------

export async function createOfferAction(input: CreateOfferInput): Promise<ActionResult<Offer>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.create')
  if (!auth.ok) return toActionFailure(auth)
  const result = await svcCreateOffer(r.ctx, input)
  if (result.ok) safeRevalidate('/offers')
  return toAction(result)
}

export async function editOfferAction(input: EditOfferInput): Promise<ActionResult<Offer>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.edit')
  if (!auth.ok) return toActionFailure(auth)
  const result = await svcEditOffer(r.ctx, input)
  if (result.ok) safeRevalidate(`/offers/${input.offerId}`)
  return toAction(result)
}

export async function submitOfferForApprovalAction(offerId: string): Promise<ActionResult<Offer>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.submit_for_approval')
  if (!auth.ok) return toActionFailure(auth)
  const result = await submitOfferForApproval(r.ctx, offerId)
  if (result.ok) safeRevalidate(`/offers/${offerId}`)
  return toAction(result)
}

/**
 * Audit P1-02 — this action was dead code: the "Return for changes"
 * button called `submitOfferForApprovalAction` instead, which tried
 * PENDING_APPROVAL → PENDING_APPROVAL and always failed.
 */
export async function returnOfferForChangesAction(offerId: string): Promise<ActionResult<Offer>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.approve')
  if (!auth.ok) return toActionFailure(auth)
  const result = await returnOfferForChanges(r.ctx, offerId)
  if (result.ok) safeRevalidate(`/offers/${offerId}`)
  return toAction(result)
}

export async function approveOfferAction(offerId: string, confirm: boolean): Promise<ActionResult<Offer> & { warning?: string }> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.approve')
  if (!auth.ok) return toActionFailure(auth)
  const result = await approveOffer(r.ctx, offerId, confirm)
  if (result.ok) {
    safeRevalidate(`/offers/${offerId}`)
    return { ok: true, data: result.data, ...(result.warning ? { warning: result.warning } : {}) }
  }
  return toAction(result)
}

export async function issueOfferAction(offerId: string, confirm: boolean): Promise<ActionResult<Offer>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.issue')
  if (!auth.ok) return toActionFailure(auth)
  const result = await issueOffer(r.ctx, offerId, confirm)
  if (result.ok) safeRevalidate(`/offers/${offerId}`)
  return toAction(result)
}

export async function recordOfferResponseAction(
  offerId: string,
  response: 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN' | 'EXPIRED',
  options: { reason?: string; confirm?: boolean } = {},
): Promise<ActionResult<Offer>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.record_response')
  if (!auth.ok) return toActionFailure(auth)
  const result = await recordOfferResponse(r.ctx, offerId, response, options)
  if (result.ok) {
    safeRevalidate(`/offers/${offerId}`)
    safeRevalidate('/offers')
  }
  return toAction(result)
}

/**
 * Audit P1-03 — withdraw an offer. Works for an ISSUED offer and for an
 * APPROVED one: before this, APPROVED was a one-way dead end.
 */
export async function withdrawOfferAction(offerId: string, reason: string): Promise<ActionResult<Offer>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.withdraw')
  if (!auth.ok) return toActionFailure(auth)
  const result = await withdrawOffer(r.ctx, offerId, reason)
  if (result.ok) {
    safeRevalidate(`/offers/${offerId}`)
    safeRevalidate('/offers')
  }
  return toAction(result)
}

/** Audit P1-04 — expire an offer whose expiry date has passed. */
export async function expireOfferAction(offerId: string): Promise<ActionResult<Offer>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.withdraw')
  if (!auth.ok) return toActionFailure(auth)
  const result = await expireOffer(r.ctx, offerId)
  if (result.ok) {
    safeRevalidate(`/offers/${offerId}`)
    safeRevalidate('/offers')
  }
  return toAction(result)
}

/**
 * Audit P1-02 — cancel a DRAFT offer. A draft that is abandoned used to
 * stay in DRAFT forever, blocking a replacement offer for the same
 * candidate.
 */
export async function cancelDraftOfferAction(offerId: string, reason: string): Promise<ActionResult<{ id: string; cancelled: true }>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.edit')
  if (!auth.ok) return toActionFailure(auth)
  const result = await cancelDraftOffer(r.ctx, offerId, reason)
  if (result.ok) {
    safeRevalidate(`/offers/${offerId}`)
    safeRevalidate('/offers')
  }
  return toAction(result)
}

export async function generateOfferDraftAction(offerId: string): Promise<ActionResult<{ draft: unknown; model: string; taskId: string }>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.edit')
  if (!auth.ok) return toActionFailure(auth)
  const result = await generateOfferDraft(r.ctx, offerId)
  if (result.ok) safeRevalidate(`/offers/${offerId}`)
  return toAction(result)
}

export async function setOfferDraftContentAction(
  offerId: string,
  draftContent: unknown,
): Promise<ActionResult<Offer>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.edit')
  if (!auth.ok) return toActionFailure(auth)
  const result = await setOfferDraftContent(r.ctx, offerId, draftContent, { aiGenerated: false })
  if (result.ok) safeRevalidate(`/offers/${offerId}`)
  return toAction(result)
}

// -----------------------------------------------------------------------------
// Metrics for dashboard
// -----------------------------------------------------------------------------

export interface OfferMetrics {
  draft: number
  pendingApproval: number
  approved: number
  issued: number
  accepted: number
  declined: number
  withdrawn: number
  expired: number
  expiringSoon: number
  /**
   * accepted / (accepted + declined) — the share of ANSWERED offers the
   * candidate accepted. Audit P1-04: the old denominator was
   * `issued + accepted`, which reported `null` for an org whose offers
   * were all declined (never 0%) and counted every issued offer that
   * was still waiting for an answer as a rejection.
   */
  acceptanceRate: number | null
}

export async function getOfferMetricsAction(): Promise<ActionResult<OfferMetrics>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.view')
  if (!auth.ok) return toActionFailure(auth)
  const orgId = r.ctx.organizationId
  const soon = new Date()
  soon.setDate(soon.getDate() + 7)
  const [draft, pendingApproval, approved, issued, accepted, declined, withdrawn, expired, expiringSoon] = await Promise.all([
    db.offer.count({ where: { organizationId: orgId, status: 'DRAFT' as OfferStatus } }),
    db.offer.count({ where: { organizationId: orgId, status: 'PENDING_APPROVAL' as OfferStatus } }),
    db.offer.count({ where: { organizationId: orgId, status: 'APPROVED' as OfferStatus } }),
    db.offer.count({ where: { organizationId: orgId, status: 'ISSUED' as OfferStatus } }),
    db.offer.count({ where: { organizationId: orgId, status: 'ACCEPTED' as OfferStatus } }),
    db.offer.count({ where: { organizationId: orgId, status: 'DECLINED' as OfferStatus } }),
    db.offer.count({ where: { organizationId: orgId, status: 'WITHDRAWN' as OfferStatus } }),
    db.offer.count({ where: { organizationId: orgId, status: 'EXPIRED' as OfferStatus } }),
    db.offer.count({
      where: {
        organizationId: orgId,
        status: { in: ['ISSUED', 'APPROVED'] as OfferStatus[] },
        expiresAt: { gte: new Date(), lte: soon },
      },
    }),
  ])
  const answered = accepted + declined
  const acceptanceRate = answered > 0 ? Math.round((accepted / answered) * 100) / 100 : null
  return {
    ok: true,
    data: {
      draft,
      pendingApproval,
      approved,
      issued,
      accepted,
      declined,
      withdrawn,
      expired,
      expiringSoon,
      acceptanceRate,
    },
  }
}

// -----------------------------------------------------------------------------
// HR-scoped offer counts (for HR detail / Decision Hub)
// -----------------------------------------------------------------------------

export async function getHiringRequestOfferCountsAction(hiringRequestId: string): Promise<ActionResult<{
  selected: number
  draft: number
  issued: number
  accepted: number
  remaining: number
  openings: number
}>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.view')
  if (!auth.ok) return toActionFailure(auth)
  const hr = await db.hiringRequest.findFirst({
    where: { id: hiringRequestId, organizationId: r.ctx.organizationId },
    select: { id: true, openings: true },
  })
  if (!hr) return { ok: false, error: { code: 'NOT_FOUND', message: 'Hiring request not found.' } }
  const [selected, draft, issued, accepted] = await Promise.all([
    db.candidateDecision.count({
      where: { hiringRequestId, organizationId: r.ctx.organizationId, decision: 'SELECTED' as never },
    }),
    db.offer.count({ where: { hiringRequestId, organizationId: r.ctx.organizationId, status: 'DRAFT' as OfferStatus } }),
    db.offer.count({ where: { hiringRequestId, organizationId: r.ctx.organizationId, status: { in: ['ISSUED', 'APPROVED'] as OfferStatus[] } } }),
    db.offer.count({ where: { hiringRequestId, organizationId: r.ctx.organizationId, status: 'ACCEPTED' as OfferStatus } }),
  ])
  const remaining = Math.max(0, (hr.openings ?? 1) - accepted)
  return { ok: true, data: { selected, draft, issued, accepted, remaining, openings: hr.openings ?? 1 } }
}

export async function getCandidateEligibilityForOfferAction(candidateId: string, hiringRequestId: string): Promise<ActionResult<{
  eligible: boolean
  reason: string | null
  existingOfferId: string | null
}>> {
  const r = await resolveCtx()
  if (!r.ok) return r.result
  const auth = await requirePermission('offer.view')
  if (!auth.ok) return toActionFailure(auth)
  const [candidate, hr, latestDecision, offers] = await Promise.all([
    db.candidate.findFirst({ where: { id: candidateId, organizationId: r.ctx.organizationId }, select: { id: true, organizationId: true } }),
    db.hiringRequest.findFirst({ where: { id: hiringRequestId, organizationId: r.ctx.organizationId }, select: { id: true, organizationId: true } }),
    db.candidateDecision.findFirst({
      where: { candidateId, hiringRequestId, organizationId: r.ctx.organizationId },
      orderBy: { decidedAt: 'desc' },
    }),
    db.offer.findMany({
      where: { candidateId, hiringRequestId, organizationId: r.ctx.organizationId },
      select: { id: true, status: true },
    }),
  ])
  if (!candidate || !hr) return { ok: false, error: { code: 'NOT_FOUND', message: 'Candidate or hiring request not found.' } }
  const { checkOfferEligibility, isActiveOfferStatus } = await import('@/lib/offers/eligibility')
  const result = checkOfferEligibility({
    candidate,
    hiringRequestId,
    hiringRequestOrganizationId: hr.organizationId,
    latestDecision: latestDecision
      ? { candidateId: latestDecision.candidateId, hiringRequestId: latestDecision.hiringRequestId, decision: latestDecision.decision }
      : null,
    existingOffers: offers as any,
  })
  const existing = offers.find(o => isActiveOfferStatus(o.status as OfferStatus))
  return {
    ok: true,
    data: {
      eligible: result.ok,
      reason: result.ok ? null : result.message,
      existingOfferId: existing?.id ?? null,
    },
  }
}
