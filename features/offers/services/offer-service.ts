'use server'

/**
 * Sprint 10 — Offer service.
 *
 * The single entry point for all Offer state transitions and
 * persistence. Wraps the pure `validateTransition()` state machine
 * with DB persistence + Activity timeline + Audit log.
 *
 * Every method returns a typed `OfferServiceResult`. The actions
 * layer (features/offers/actions/*.ts) maps this to `ActionResult`.
 *
 * Tenant isolation is enforced at the query layer (every
 * `findFirst` / `update` includes `organizationId: ctx.organizationId`).
 */

import 'server-only'
import { OfferStatus, ActivityType, type Offer } from '@prisma/client'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'
import {
  validateTransition,
  type OfferTransitionCode,
  type OfferTransitionResult,
} from '@/lib/offers/state-machine'
import { checkOfferEligibility } from '@/lib/offers/eligibility'
import { getAIEngine } from '@/lib/ai/service/ai-engine'
import { enforceAiQuota, recordAiUsage } from '@/lib/ai/quota'
import {
  buildOfferLetterUserPrompt,
  offerLetterPrompt,
  type OfferLetterPromptFacts,
} from '@/lib/ai/prompts/offer-letter'
import type { OfferLetterOutput } from '@/lib/ai/schemas/offer-letter.schema'

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

export type ServiceFailureCode =
  | 'OFFER_NOT_FOUND'
  | 'CANDIDATE_NOT_FOUND'
  | 'HIRING_REQUEST_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'NOT_ELIGIBLE'
  | 'ACTIVE_OFFER_EXISTS'
  | 'INVALID_TRANSITION'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'AI_UNAVAILABLE'
  | 'PERSISTENCE_ERROR'
  | 'VALIDATION'

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ServiceFailureCode; message: string; meta?: Record<string, unknown> }

function fail<T>(code: ServiceFailureCode, message: string, meta?: Record<string, unknown>): ServiceResult<T> {
  return { ok: false, code, message, meta }
}

interface Ctx {
  userId: string
  organizationId: string
  isAdmin: boolean
  isTaLead: boolean
  role: string
}

// -----------------------------------------------------------------------------
// Read paths
// -----------------------------------------------------------------------------

/**
 * Read a single offer, enforcing tenant isolation. Returns NOT_FOUND
 * (never 403) so a cross-tenant IDOR attempt does not reveal resource
 * existence.
 */
export async function getOffer(ctx: Ctx, offerId: string): Promise<ServiceResult<Offer>> {
  const offer = await db.offer.findFirst({
    where: { id: offerId, organizationId: ctx.organizationId },
  })
  if (!offer) return fail('OFFER_NOT_FOUND', 'Offer not found.')
  return { ok: true, data: offer }
}

/**
 * List offers for the current organization, ordered most-recent first.
 * Caller passes the where-clause to filter at the DB level.
 */
export async function listOffersForOrg(
  ctx: Ctx,
  where: { status?: OfferStatus; hiringRequestId?: string; candidateId?: string } = {},
): Promise<ServiceResult<Offer[]>> {
  const offers = await db.offer.findMany({
    where: { organizationId: ctx.organizationId, ...where },
    orderBy: [{ updatedAt: 'desc' }],
  })
  return { ok: true, data: offers }
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export interface CreateOfferInput {
  candidateId: string
  hiringRequestId: string
  title: string
  salaryAmount: number
  salaryCurrency: string
  salaryPeriod: string
  bonusAmount?: number | null
  equityAmount?: string | null
  commissionAmount?: number | null
  employmentType?: string | null
  workArrangement?: string | null
  startDate?: Date | null
  expiresAt?: Date | null
  probationPeriodDays?: number | null
  noticePeriodDays?: number | null
  vacationDays?: number | null
  benefits?: string | null
  additionalTerms?: string | null
  notes?: string | null
}

/**
 * Creates a DRAFT offer for a candidate who is human-SELECTED.
 * Throws NOT_ELIGIBLE if the candidate is not eligible.
 * Throws ACTIVE_OFFER_EXISTS if there is already an active offer.
 */
export async function createOffer(ctx: Ctx, input: CreateOfferInput): Promise<ServiceResult<Offer>> {
  // Verify candidate + tenant
  const candidate = await db.candidate.findFirst({
    where: { id: input.candidateId, organizationId: ctx.organizationId },
  })
  if (!candidate) return fail('CANDIDATE_NOT_FOUND', 'Candidate not found.')

  const hiringRequest = await db.hiringRequest.findFirst({
    where: { id: input.hiringRequestId, organizationId: ctx.organizationId },
  })
  if (!hiringRequest) return fail('HIRING_REQUEST_NOT_FOUND', 'Hiring request not found.')

  // Eligibility
  const latestDecision = await db.candidateDecision.findFirst({
    where: { candidateId: input.candidateId, hiringRequestId: input.hiringRequestId },
    orderBy: { decidedAt: 'desc' },
  })
  const existingOffers = await db.offer.findMany({
    where: { candidateId: input.candidateId, hiringRequestId: input.hiringRequestId },
    select: { id: true, candidateId: true, hiringRequestId: true, status: true },
  })
  const eligibility = checkOfferEligibility({
    candidate: { id: candidate.id, organizationId: candidate.organizationId },
    hiringRequestId: input.hiringRequestId,
    hiringRequestOrganizationId: hiringRequest.organizationId,
    latestDecision: latestDecision
      ? { candidateId: latestDecision.candidateId, hiringRequestId: latestDecision.hiringRequestId, decision: latestDecision.decision }
      : null,
    existingOffers,
  })
  if (!eligibility.ok) {
    if (eligibility.code === 'ACTIVE_OFFER_EXISTS') {
      return fail('ACTIVE_OFFER_EXISTS', eligibility.message, { blockingOfferId: eligibility.blockingOfferId })
    }
    return fail('NOT_ELIGIBLE', eligibility.message, { eligibilityCode: eligibility.code })
  }

  // Date validation
  if (input.startDate && input.expiresAt && input.expiresAt.getTime() < Date.now()) {
    return fail('VALIDATION', 'Offer expiry cannot be in the past.')
  }
  if (input.startDate && input.expiresAt && input.expiresAt.getTime() < input.startDate.getTime()) {
    return fail('VALIDATION', 'Offer expiry cannot be before the proposed start date.')
  }

  // Persist
  const offer = await db.offer.create({
    data: {
      organizationId: ctx.organizationId,
      candidateId: input.candidateId,
      hiringRequestId: input.hiringRequestId,
      title: input.title,
      status: OfferStatus.DRAFT,
      salaryAmount: input.salaryAmount,
      salaryCurrency: input.salaryCurrency as never,
      salaryPeriod: input.salaryPeriod,
      bonusAmount: input.bonusAmount ?? null,
      equityAmount: input.equityAmount ?? null,
      commissionAmount: input.commissionAmount ?? null,
      startDate: input.startDate ?? null,
      expiresAt: input.expiresAt ?? null,
      employmentType: input.employmentType ?? null,
      workArrangement: input.workArrangement ?? null,
      probationPeriodDays: input.probationPeriodDays ?? null,
      noticePeriodDays: input.noticePeriodDays ?? null,
      vacationDays: input.vacationDays ?? null,
      benefits: input.benefits ?? null,
      additionalTerms: input.additionalTerms ?? null,
      notes: input.notes ?? null,
      createdById: ctx.userId,
    },
  })

  // Activity + audit
  await recordActivity(ctx, {
    type: ActivityType.OFFER_CREATED,
    offerId: offer.id,
    candidateId: offer.candidateId,
    hiringRequestId: offer.hiringRequestId,
    title: 'Offer created',
    description: input.title,
  })
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'OFFER_CREATED',
    targetType: 'offer',
    targetId: offer.id,
    outcome: 'success',
    metadata: { candidateId: offer.candidateId, hiringRequestId: offer.hiringRequestId },
  })

  return { ok: true, data: offer }
}

// -----------------------------------------------------------------------------
// Edit (DRAFT only)
// -----------------------------------------------------------------------------

export interface EditOfferInput extends Partial<CreateOfferInput> {
  offerId: string
}

export async function editOffer(ctx: Ctx, input: EditOfferInput): Promise<ServiceResult<Offer>> {
  const existing = await db.offer.findFirst({
    where: { id: input.offerId, organizationId: ctx.organizationId },
  })
  if (!existing) return fail('OFFER_NOT_FOUND', 'Offer not found.')
  if (existing.status !== OfferStatus.DRAFT) {
    return fail('INVALID_TRANSITION', `Cannot edit an offer in status ${existing.status}. Return it to DRAFT first.`)
  }
  const { offerId, ...patch } = input
  const updated = await db.offer.update({
    where: { id: offerId },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.salaryAmount !== undefined ? { salaryAmount: patch.salaryAmount } : {}),
      ...(patch.salaryCurrency !== undefined ? { salaryCurrency: patch.salaryCurrency as never } : {}),
      ...(patch.salaryPeriod !== undefined ? { salaryPeriod: patch.salaryPeriod } : {}),
      ...(patch.bonusAmount !== undefined ? { bonusAmount: patch.bonusAmount } : {}),
      ...(patch.equityAmount !== undefined ? { equityAmount: patch.equityAmount } : {}),
      ...(patch.commissionAmount !== undefined ? { commissionAmount: patch.commissionAmount } : {}),
      ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
      ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
      ...(patch.employmentType !== undefined ? { employmentType: patch.employmentType } : {}),
      ...(patch.workArrangement !== undefined ? { workArrangement: patch.workArrangement } : {}),
      ...(patch.probationPeriodDays !== undefined ? { probationPeriodDays: patch.probationPeriodDays } : {}),
      ...(patch.noticePeriodDays !== undefined ? { noticePeriodDays: patch.noticePeriodDays } : {}),
      ...(patch.vacationDays !== undefined ? { vacationDays: patch.vacationDays } : {}),
      ...(patch.benefits !== undefined ? { benefits: patch.benefits } : {}),
      ...(patch.additionalTerms !== undefined ? { additionalTerms: patch.additionalTerms } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    },
  })
  await recordActivity(ctx, {
    type: ActivityType.OFFER_EDITED,
    offerId: updated.id,
    candidateId: updated.candidateId,
    hiringRequestId: updated.hiringRequestId,
    title: 'Offer edited',
  })
  return { ok: true, data: updated }
}

// -----------------------------------------------------------------------------
// Letter content
// -----------------------------------------------------------------------------

export async function setOfferDraftContent(
  ctx: Ctx,
  offerId: string,
  draftContent: unknown,
  meta: { aiGenerated?: boolean; aiTaskId?: string | null; promptVersion?: string | null; modelUsed?: string | null },
): Promise<ServiceResult<Offer>> {
  const existing = await db.offer.findFirst({
    where: { id: offerId, organizationId: ctx.organizationId },
  })
  if (!existing) return fail('OFFER_NOT_FOUND', 'Offer not found.')
  if (existing.status === OfferStatus.ACCEPTED || existing.status === OfferStatus.DECLINED || existing.status === OfferStatus.WITHDRAWN || existing.status === OfferStatus.EXPIRED) {
    return fail('INVALID_TRANSITION', 'Cannot edit the letter of a terminal offer.')
  }
  const updated = await db.offer.update({
    where: { id: offerId },
    data: {
      draftContent: draftContent as any,
      ...(meta.aiGenerated ? { aiGeneratedAt: new Date() } : {}),
      ...(meta.aiTaskId ? { aiTaskId: meta.aiTaskId } : {}),
      ...(meta.promptVersion ? { aiPromptVersion: meta.promptVersion } : {}),
      ...(meta.modelUsed ? { aiModelUsed: meta.modelUsed } : {}),
    },
  })
  if (meta.aiGenerated) {
    await recordActivity(ctx, {
      type: ActivityType.OFFER_DRAFT_GENERATED,
      offerId: updated.id,
      candidateId: updated.candidateId,
      hiringRequestId: updated.hiringRequestId,
      title: 'AI offer letter draft generated',
    })
  }
  return { ok: true, data: updated }
}

// -----------------------------------------------------------------------------
// AI draft generation
// -----------------------------------------------------------------------------

export async function generateOfferDraft(
  ctx: Ctx,
  offerId: string,
): Promise<ServiceResult<{ draft: OfferLetterOutput; taskId: string; model: string }>> {
  const offer = await db.offer.findFirst({
    where: { id: offerId, organizationId: ctx.organizationId },
    include: {
      candidate: { select: { firstName: true, lastName: true } },
      hiringRequest: {
        select: {
          title: true,
          department: { select: { name: true } },
          hiringManager: { select: { firstName: true, lastName: true } },
        },
      },
      organization: { select: { name: true } },
    },
  })
  if (!offer) return fail('OFFER_NOT_FOUND', 'Offer not found.')
  if (offer.status === OfferStatus.ACCEPTED || offer.status === OfferStatus.DECLINED || offer.status === OfferStatus.WITHDRAWN || offer.status === OfferStatus.EXPIRED) {
    return fail('INVALID_TRANSITION', 'Cannot regenerate the letter of a terminal offer.')
  }

  const candidateName = `${offer.candidate.firstName} ${offer.candidate.lastName}`.trim()
  const department = offer.hiringRequest.department?.name ?? ''
  const hiringManagerName = offer.hiringRequest.hiringManager
    ? `${offer.hiringRequest.hiringManager.firstName} ${offer.hiringRequest.hiringManager.lastName}`.trim()
    : null

  const facts: OfferLetterPromptFacts = {
    candidateName,
    jobTitle: offer.title,
    department,
    employmentType: offer.employmentType,
    workArrangement: offer.workArrangement,
    startDate: offer.startDate?.toISOString() ?? null,
    expiryDate: offer.expiresAt?.toISOString() ?? null,
    companyName: offer.organization.name,
    hiringManagerName,
    baseSalaryAmount: offer.salaryAmount,
    baseSalaryCurrency: offer.salaryCurrency,
    baseSalaryPeriod: offer.salaryPeriod,
    bonusAmount: offer.bonusAmount,
    equityAmount: offer.equityAmount,
    commissionAmount: offer.commissionAmount,
    vacationDays: offer.vacationDays,
    benefits: offer.benefits,
    additionalTerms: offer.additionalTerms,
    probationPeriodDays: offer.probationPeriodDays,
    noticePeriodDays: offer.noticePeriodDays,
  }

  // Persist the AITask so we have an audit trail even if the model fails.
  const aiTask = await db.aITask.create({
    data: {
      organizationId: ctx.organizationId,
      type: 'OFFER_LETTER' as never,
      title: `Offer letter draft: ${candidateName} — ${offer.title}`,
      prompt: buildOfferLetterUserPrompt(facts),
      status: 'RUNNING' as never,
      createdById: ctx.userId,
      startedAt: new Date(),
    },
  })

  let draft: OfferLetterOutput
  let modelUsed = 'unknown'
  try {
    // Sprint 16 — per-org AI quota. Refuse if over limit.
    const quotaCheck = await enforceAiQuota(ctx.organizationId, 'offer_letter')
    if (!quotaCheck.allowed) {
      throw new Error(quotaCheck.message ?? 'AI_LIMIT_REACHED')
    }

    const engine = getAIEngine()
    const result = await engine.generateOfferLetter(facts)
    await recordAiUsage({
      organizationId: ctx.organizationId,
      feature: 'offer_letter',
      tokensIn: result.usage.inputTokens,
      tokensOut: result.usage.outputTokens,
    })
    draft = result.data
    modelUsed = result.model
    await db.aITask.update({
      where: { id: aiTask.id },
      data: {
        status: 'COMPLETED' as never,
        result: draft as any,
        modelUsed,
        completedAt: new Date(),
        durationMs: Date.now() - (aiTask.startedAt?.getTime() ?? Date.now()),
      },
    })
  } catch (err) {
    await db.aITask.update({
      where: { id: aiTask.id },
      data: {
        status: 'FAILED' as never,
        errorMessage: err instanceof Error ? err.message : 'AI generation failed',
        completedAt: new Date(),
      },
    }).catch(() => null)
    return fail('AI_UNAVAILABLE', 'AI offer-letter generation is currently unavailable. You can still write the offer letter manually.')
  }

  // Persist draft + metadata on the offer
  await db.offer.update({
    where: { id: offer.id },
    data: {
      draftContent: draft as any,
      aiGeneratedAt: new Date(),
      aiTaskId: aiTask.id,
      aiPromptVersion: offerLetterPrompt.version,
      aiModelUsed: modelUsed,
    },
  })
  await recordActivity(ctx, {
    type: ActivityType.OFFER_DRAFT_GENERATED,
    offerId: offer.id,
    candidateId: offer.candidateId,
    hiringRequestId: offer.hiringRequestId,
    title: 'AI offer letter draft generated',
  })
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'OFFER_DRAFT_GENERATED',
    targetType: 'offer',
    targetId: offer.id,
    outcome: 'success',
    metadata: { modelUsed, promptVersion: offerLetterPrompt.version, taskId: aiTask.id },
  })

  return { ok: true, data: { draft, taskId: aiTask.id, model: modelUsed } }
}

// -----------------------------------------------------------------------------
// Workflow transitions
// -----------------------------------------------------------------------------

/**
 * Validates a transition against the state machine, then persists it.
 * Returns the new offer on success. Writes Activity + AuditLog.
 */
async function transition(
  ctx: Ctx,
  offerId: string,
  to: OfferStatus,
  activityType: ActivityType,
  auditAction: 'OFFER_SUBMITTED_FOR_APPROVAL' | 'OFFER_RETURNED_FOR_CHANGES' | 'OFFER_APPROVED' | 'OFFER_SELF_APPROVED_BY_ADMIN' | 'OFFER_ISSUED' | 'OFFER_ACCEPTED' | 'OFFER_DECLINED' | 'OFFER_WITHDRAWN' | 'OFFER_EXPIRED' | 'OFFER_EDITED' | 'OFFER_CREATED',
  extraPatch: Record<string, unknown> = {},
  extraMeta: Record<string, unknown> = {},
): Promise<ServiceResult<Offer>> {
  const existing = await db.offer.findFirst({
    where: { id: offerId, organizationId: ctx.organizationId },
  })
  if (!existing) return fail('OFFER_NOT_FOUND', 'Offer not found.')
  const result: OfferTransitionResult = validateTransition(existing.status, to)
  if (!result.ok) {
    return fail('INVALID_TRANSITION', result.reason, { from: existing.status, to })
  }
  const updated = await db.offer.update({
    where: { id: offerId },
    data: { status: to, ...extraPatch },
  })
  await recordActivity(ctx, {
    type: activityType,
    offerId: updated.id,
    candidateId: updated.candidateId,
    hiringRequestId: updated.hiringRequestId,
    title: activityTitle(activityType),
    metadata: extraMeta,
  })
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: auditAction,
    targetType: 'offer',
    targetId: updated.id,
    outcome: 'success',
    metadata: extraMeta,
  })
  return { ok: true, data: updated }
}

function activityTitle(t: ActivityType): string {
  switch (t) {
    case ActivityType.OFFER_SUBMITTED_FOR_APPROVAL: return 'Offer submitted for approval'
    case ActivityType.OFFER_RETURNED_FOR_CHANGES:    return 'Offer returned for changes'
    case ActivityType.OFFER_APPROVED:                return 'Offer approved'
    case ActivityType.OFFER_ISSUED:                 return 'Offer issued'
    case ActivityType.OFFER_ACCEPTED:               return 'Offer accepted'
    case ActivityType.OFFER_DECLINED:               return 'Offer declined'
    case ActivityType.OFFER_WITHDRAWN:              return 'Offer withdrawn'
    case ActivityType.OFFER_EXPIRED:                return 'Offer expired'
    case ActivityType.OFFER_EDITED:                 return 'Offer edited'
    case ActivityType.OFFER_CREATED:                return 'Offer created'
    case ActivityType.OFFER_DRAFT_GENERATED:        return 'AI offer letter draft generated'
    default:                                        return 'Offer activity'
  }
}

export async function submitOfferForApproval(ctx: Ctx, offerId: string): Promise<ServiceResult<Offer>> {
  return transition(ctx, offerId, OfferStatus.PENDING_APPROVAL, ActivityType.OFFER_SUBMITTED_FOR_APPROVAL, 'OFFER_SUBMITTED_FOR_APPROVAL')
}

export async function returnOfferForChanges(ctx: Ctx, offerId: string): Promise<ServiceResult<Offer>> {
  return transition(ctx, offerId, OfferStatus.DRAFT, ActivityType.OFFER_RETURNED_FOR_CHANGES, 'OFFER_RETURNED_FOR_CHANGES')
}

/**
 * Approve an offer. PART 15 approval separation:
 *   - The same user who created the offer cannot approve it UNLESS they
 *     are the only ADMIN/TA_LEAD in the org (last-resort escape hatch).
 *   - When the escape hatch fires, the offer is marked with a flag
 *     `aiPromptVersion: SELF_APPROVED` and the audit log records
 *     OFFER_SELF_APPROVED_BY_ADMIN.
 */
export async function approveOffer(ctx: Ctx, offerId: string, confirm: boolean): Promise<ServiceResult<Offer>> {
  if (!confirm) return fail('VALIDATION', 'Approval requires explicit human confirmation.')
  const existing = await db.offer.findFirst({
    where: { id: offerId, organizationId: ctx.organizationId },
  })
  if (!existing) return fail('OFFER_NOT_FOUND', 'Offer not found.')
  // Approval separation
  if (existing.createdById === ctx.userId) {
    // Check if there is another ADMIN/TA_LEAD who could approve instead.
    const otherApprovers = await db.user.count({
      where: {
        organizationId: ctx.organizationId,
        id: { not: ctx.userId },
        role: { in: ['ADMIN', 'TA_LEAD'] as never[] },
        status: 'ACTIVE' as never,
        disabledAt: null,
      },
    })
    if (otherApprovers > 0) {
      return fail(
        'SELF_APPROVAL_FORBIDDEN',
        'You cannot approve an offer you created when another authorized approver is available.',
      )
    }
    // ADMIN escape hatch: no other approver, this ADMIN is the only one.
    const updated = await transition(
      ctx,
      offerId,
      OfferStatus.APPROVED,
      ActivityType.OFFER_APPROVED,
      'OFFER_SELF_APPROVED_BY_ADMIN',
      { approvedById: ctx.userId, approvedAt: new Date() },
      { selfApproved: true, reason: 'no_other_approver_available' },
    )
    return updated
  }
  return transition(
    ctx,
    offerId,
    OfferStatus.APPROVED,
    ActivityType.OFFER_APPROVED,
    'OFFER_APPROVED',
    { approvedById: ctx.userId, approvedAt: new Date() },
  )
}

export async function issueOffer(ctx: Ctx, offerId: string, confirm: boolean): Promise<ServiceResult<Offer>> {
  if (!confirm) return fail('VALIDATION', 'Issuing requires explicit human confirmation that the offer was sent/shared externally.')
  return transition(
    ctx,
    offerId,
    OfferStatus.ISSUED,
    ActivityType.OFFER_ISSUED,
    'OFFER_ISSUED',
    { issuedById: ctx.userId, issuedAt: new Date(), sentAt: new Date() },
  )
}

export async function recordOfferResponse(
  ctx: Ctx,
  offerId: string,
  response: 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN' | 'EXPIRED',
  options: { reason?: string; confirm?: boolean } = {},
): Promise<ServiceResult<Offer>> {
  if (response === 'ACCEPTED' && !options.confirm) {
    return fail('VALIDATION', 'Recording acceptance requires explicit human confirmation.')
  }
  if (response === 'WITHDRAWN' && !options.reason) {
    return fail('VALIDATION', 'Withdrawal requires a reason.')
  }
  const targetStatus = response as OfferStatus
  const extraPatch: Record<string, unknown> = { respondedAt: new Date() }
  let activityType: ActivityType
  let auditAction: 'OFFER_ACCEPTED' | 'OFFER_DECLINED' | 'OFFER_WITHDRAWN' | 'OFFER_EXPIRED'
  switch (response) {
    case 'ACCEPTED':
      extraPatch.acceptedAt = new Date()
      activityType = ActivityType.OFFER_ACCEPTED
      auditAction = 'OFFER_ACCEPTED'
      break
    case 'DECLINED':
      extraPatch.declinedAt = new Date()
      if (options.reason) extraPatch.declineReason = options.reason
      activityType = ActivityType.OFFER_DECLINED
      auditAction = 'OFFER_DECLINED'
      break
    case 'WITHDRAWN':
      extraPatch.withdrawnAt = new Date()
      if (options.reason) extraPatch.withdrawnReason = options.reason
      activityType = ActivityType.OFFER_WITHDRAWN
      auditAction = 'OFFER_WITHDRAWN'
      break
    case 'EXPIRED':
      extraPatch.expiredAt = new Date()
      activityType = ActivityType.OFFER_EXPIRED
      auditAction = 'OFFER_EXPIRED'
      break
  }
  return transition(ctx, offerId, targetStatus, activityType, auditAction, extraPatch, { reason: options.reason ?? null })
}

// -----------------------------------------------------------------------------
// Activity writer
// -----------------------------------------------------------------------------

async function recordActivity(
  ctx: Ctx,
  input: { type: ActivityType; offerId: string; candidateId: string; hiringRequestId: string; title: string; description?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    await db.activity.create({
      data: {
        organizationId: ctx.organizationId,
        type: input.type,
        actorId: ctx.userId,
        offerId: input.offerId,
        candidateId: input.candidateId,
        hiringRequestId: input.hiringRequestId,
        title: input.title,
        description: input.description ?? null,
        metadata: (input.metadata ?? {}) as any,
      },
    })
  } catch {
    /* activity writes are best-effort; the offer transition is the source of truth */
  }
}
