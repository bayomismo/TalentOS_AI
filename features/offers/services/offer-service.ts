'use server'

/**
 * Sprint 10 / 19 — Offer service.
 *
 * The single entry point for all Offer state transitions and
 * persistence. Wraps the pure `validateTransition()` state machine
 * with DB persistence + Activity timeline + Audit log.
 *
 * Every method returns a typed `OfferServiceResult`. The actions
 * layer (features/offers/actions/*.ts) maps this to `ActionResult`.
 *
 * Tenant isolation is enforced at the query layer (every
 * `findFirst` / `update` includes `organizationId: ctx.organizationId`)
 * AND on the foreign keys the offer points at — an Offer row whose
 * `candidateId` belongs to another tenant must not be readable or
 * writable through this service even if the Offer row itself carries
 * the caller's organization.
 *
 * SPRINT 19 CHANGES (business-flow audit)
 * ----------------------------------------
 *   P0-01/P0-02  An ACCEPTED offer now HIRES the candidate — in ONE
 *                transaction: offer status, candidate stage, `hiredAt`,
 *                `HiringRequest.filled` and the requisition status.
 *                Before this, an accepted offer hired nobody and
 *                `filled` was permanently 0.
 *   P0-05       The letter can only be edited while the offer is a
 *                DRAFT, and the money in the letter is checked against
 *                the approved compensation fields.
 *   P1-03       APPROVED offers can be withdrawn / expired.
 *   P1-09       The approver pool includes HIRING_MANAGER.
 *   P1-13       Every edit writes an AuditLog entry with before/after.
 *   P1-15       A HIRING_MANAGER may only act on the requisitions
 *                they manage.
 *   P1-20       A HOLD / ADVANCE decision blocks a new offer.
 *   P1-28       An offer outside the requisition's salary band is
 *                refused on create and warned about on approval.
 *   P2-29       A replacement offer marks the offer it replaces as
 *                superseded.
 *   P2-30       The duplicate-offer guard is enforced inside the
 *                write transaction (row lock), not by a read-then-write.
 *   P2-11       The salary vocabulary is validated before the write, so
 *                an unknown currency is a readable error instead of a
 *                Prisma crash.
 */

import 'server-only'
import {
  OfferStatus,
  ActivityType,
  HiringRequestStatus,
  SalaryCurrency,
  type Offer,
  type Prisma,
} from '@prisma/client'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'
import {
  validateTransition,
  type OfferTransitionCode,
  type OfferTransitionResult,
} from '@/lib/offers/state-machine'
import { checkOfferEligibility } from '@/lib/offers/eligibility'
import { validateHiringRequestTransition } from '@/lib/hiring-requests/state-machine'
import {
  countHiredCandidates,
  syncHiringRequestFilled,
} from '@/lib/hiring-requests/capacity'
import { transitionCandidateStage } from '@/lib/candidates/transition'
import { syncCandidateStatus } from '@/lib/candidates/status'
import { renderSectionsToText } from '@/features/offers/lib/offer-letter'
import {
  checkCompensationConsistent,
  checkSalaryBand,
  describeDecisionHold,
  normalizeSalaryCurrency,
  normalizeSalaryPeriod,
  unsupportedCurrencyMessage,
  unsupportedPeriodMessage,
} from '@/lib/offers/compensation'
import { getAIEngine } from '@/lib/ai/service/ai-engine'
import { enforceAiQuota, runWithAiReservation } from '@/lib/ai/quota'
import {
  buildOfferLetterUserPrompt,
  offerLetterPrompt,
  type OfferLetterPromptFacts,
} from '@/lib/ai/prompts/offer-letter'
import type { OfferLetterOutput } from '@/lib/ai/schemas/offer-letter.schema'

// -----------------------------------------------------------------------------
// Legacy statuses (audit P3-04)
//
// `SENT` and `UNDER_REVIEW` are seed-only statuses: no action in the
// application can reach them, and no UI surfaces them. They are kept in
// the state machine for backward compatibility with historical rows. The
// eligibility rules treat them as historical (a new offer IS allowed for
// a candidate whose previous offer is in one of them) — see
// `lib/offers/eligibility.ts`.
//
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
  | 'COMPENSATION_MISMATCH'
  | 'SALARY_BAND_EXCEEDED'
  | 'OUTSIDE_SCOPE'
  | 'CONCURRENT_MODIFICATION'
  | 'ALREADY_TERMINAL'

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ServiceFailureCode; message: string; meta?: Record<string, unknown> }

function fail<T>(
  code: ServiceFailureCode,
  message: string,
  meta?: Record<string, unknown>,
): ServiceResult<T> {
  return { ok: false, code, message, meta }
}

interface Ctx {
  userId: string
  organizationId: string
  isAdmin: boolean
  isTaLead: boolean
  role: string
}

/**
 * The offer's own row plus the two foreign keys it points at. Both are
 * read with the caller's organization filter so a cross-tenant
 * reference can never be reached through a valid Offer row.
 */
interface OfferContext {
  offer: Offer
  candidate: { id: string; stage: string; hiredAt: Date | null; hiringRequestId: string }
  hiringRequest: {
    id: string
    status: HiringRequestStatus
    openings: number
    filled: number
    hiringManagerId: string | null
    salaryMin: number | null
    salaryMax: number | null
    salaryCurrency: string
  }
}

/**
 * Loads an offer with its candidate and requisition, tenant-scoped on
 * every edge. Returns NOT_FOUND (never 403) so a cross-tenant IDOR
 * attempt does not reveal resource existence.
 */
async function loadOfferContext(ctx: Ctx, offerId: string): Promise<ServiceResult<OfferContext>> {
  const offer = await db.offer.findFirst({
    where: { id: offerId, organizationId: ctx.organizationId },
  })
  if (!offer) return fail('OFFER_NOT_FOUND', 'Offer not found.')

  const candidate = await db.candidate.findFirst({
    where: { id: offer.candidateId, organizationId: ctx.organizationId },
    select: { id: true, stage: true, hiredAt: true, hiringRequestId: true },
  })
  if (!candidate) return fail('CANDIDATE_NOT_FOUND', 'Candidate not found.')

  const hiringRequest = await db.hiringRequest.findFirst({
    where: { id: offer.hiringRequestId, organizationId: ctx.organizationId },
    select: {
      id: true,
      status: true,
      openings: true,
      filled: true,
      hiringManagerId: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
    },
  })
  if (!hiringRequest) return fail('HIRING_REQUEST_NOT_FOUND', 'Hiring request not found.')

  return { ok: true, data: { offer, candidate, hiringRequest } }
}

/**
 * Audit P1-15 — a HIRING_MANAGER may only act on the requisitions they
 * manage. ADMIN / TA_LEAD / RECRUITER keep org-wide scope.
 */
function assertRequisitionScope(
  ctx: Ctx,
  hiringRequest: OfferContext['hiringRequest'],
): ServiceResult<true> {
  if (ctx.role !== 'HIRING_MANAGER') return { ok: true, data: true }
  if (hiringRequest.hiringManagerId === ctx.userId) return { ok: true, data: true }
  return fail(
    'OUTSIDE_SCOPE',
    'You can only act on offers for the requisitions you manage.',
  )
}

/** The statuses in which the offer letter may still be edited. */
function isEditableStatus(status: OfferStatus): boolean {
  return status === OfferStatus.DRAFT
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
 *
 * Refuses:
 *   - NOT_ELIGIBLE          — no SELECTED decision / HOLD in force
 *   - ACTIVE_OFFER_EXISTS   — an offer for this candidate is still live
 *   - VALIDATION            — unknown salary vocabulary, bad dates
 *   - SALARY_BAND_EXCEEDED  — the salary is outside the requisition band
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

  // Audit P2-11 — the salary vocabulary is validated BEFORE the write so
  // an unsupported currency is a readable error, not a Prisma crash.
  const period = normalizeSalaryPeriod(input.salaryPeriod)
  if (!period) {
    return fail('VALIDATION', unsupportedPeriodMessage(input.salaryPeriod))
  }
  const currency = normalizeSalaryCurrency(input.salaryCurrency)
  if (!currency) {
    return fail('VALIDATION', unsupportedCurrencyMessage(input.salaryCurrency))
  }
  if (!Number.isFinite(input.salaryAmount) || input.salaryAmount <= 0) {
    return fail('VALIDATION', 'The salary amount must be a positive number.')
  }

  // Eligibility
  const latestDecision = await db.candidateDecision.findFirst({
    where: {
      candidateId: input.candidateId,
      hiringRequestId: input.hiringRequestId,
      organizationId: ctx.organizationId,
    },
    orderBy: { decidedAt: 'desc' },
  })
  const existingOffers = await db.offer.findMany({
    where: {
      candidateId: input.candidateId,
      hiringRequestId: input.hiringRequestId,
      organizationId: ctx.organizationId,
    },
    select: { id: true, candidateId: true, hiringRequestId: true, status: true },
  })
  const eligibility = checkOfferEligibility({
    candidate: { id: candidate.id, organizationId: candidate.organizationId },
    hiringRequestId: input.hiringRequestId,
    hiringRequestOrganizationId: hiringRequest.organizationId,
    latestDecision: latestDecision
      ? {
          candidateId: latestDecision.candidateId,
          hiringRequestId: latestDecision.hiringRequestId,
          decision: latestDecision.decision,
        }
      : null,
    existingOffers,
  })
  if (!eligibility.ok) {
    if (eligibility.code === 'ACTIVE_OFFER_EXISTS') {
      return fail('ACTIVE_OFFER_EXISTS', eligibility.message, {
        blockingOfferId: eligibility.blockingOfferId,
      })
    }
    return fail('NOT_ELIGIBLE', eligibility.message, { eligibilityCode: eligibility.code })
  }

  // Audit P1-20 — a HOLD (or a non-final ADVANCE) blocks the offer even
  // when an older SELECTED decision exists.
  const holdMessage = describeDecisionHold(latestDecision?.decision ?? null)
  if (holdMessage) {
    return fail('NOT_ELIGIBLE', holdMessage, { eligibilityCode: 'DECISION_ON_HOLD' })
  }

  // Date validation
  if (input.startDate && input.expiresAt && input.expiresAt.getTime() < Date.now()) {
    return fail('VALIDATION', 'Offer expiry cannot be in the past.')
  }
  if (input.startDate && input.expiresAt && input.expiresAt.getTime() < input.startDate.getTime()) {
    return fail('VALIDATION', 'Offer expiry cannot be before the proposed start date.')
  }

  // Audit P1-28 — the requisition's published band is a budget
  // guardrail, not a suggestion.
  const band = checkSalaryBand(input.salaryAmount, currency, period, {
    min: hiringRequest.salaryMin,
    max: hiringRequest.salaryMax,
    currency: hiringRequest.salaryCurrency,
  })
  if (!band.ok) {
    return fail('SALARY_BAND_EXCEEDED', band.message ?? 'The salary is outside the published band.')
  }

  // Audit P2-30 — the duplicate-offer guard is enforced INSIDE the write
  // transaction (with a row lock on the candidate), so two concurrent
  // creates cannot both pass a read-then-write check.
  const created = await db.$transaction(async (tx) => {
    await lockCandidateRow(tx, input.candidateId)

    const activeNow = await tx.offer.findFirst({
      where: {
        candidateId: input.candidateId,
        hiringRequestId: input.hiringRequestId,
        organizationId: ctx.organizationId,
        status: {
          in: [
            OfferStatus.DRAFT,
            OfferStatus.PENDING_APPROVAL,
            OfferStatus.APPROVED,
            OfferStatus.ISSUED,
            OfferStatus.ACCEPTED,
          ],
        },
      },
      select: { id: true },
    })
    if (activeNow) {
      return {
        ok: false as const,
        code: 'ACTIVE_OFFER_EXISTS' as const,
        message: 'An active offer already exists for this candidate and hiring request.',
        meta: { blockingOfferId: activeNow.id },
      }
    }

    const offer = await tx.offer.create({
      data: {
        organizationId: ctx.organizationId,
        candidateId: input.candidateId,
        hiringRequestId: input.hiringRequestId,
        title: input.title,
        status: OfferStatus.DRAFT,
        salaryAmount: input.salaryAmount,
        salaryCurrency: currency,
        salaryPeriod: period,
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

    // Audit P2-29 — a replacement offer marks the offer it replaces as
    // superseded, so the list shows which offer is live.
    const replaced = await tx.offer.findMany({
      where: {
        candidateId: input.candidateId,
        hiringRequestId: input.hiringRequestId,
        organizationId: ctx.organizationId,
        id: { not: offer.id },
        supersededAt: null,
        status: {
          in: [OfferStatus.DECLINED, OfferStatus.WITHDRAWN, OfferStatus.EXPIRED],
        },
      },
      select: { id: true },
    })
    if (replaced.length > 0) {
      await tx.offer.updateMany({
        where: { id: { in: replaced.map((r) => r.id) }, organizationId: ctx.organizationId },
        data: { supersededAt: new Date() },
      })
    }

    await tx.activity.create({
      data: {
        organizationId: ctx.organizationId,
        type: ActivityType.OFFER_CREATED,
        actorId: ctx.userId,
        offerId: offer.id,
        candidateId: offer.candidateId,
        hiringRequestId: offer.hiringRequestId,
        title: 'Offer created',
        description: input.title,
        metadata: {
          salaryAmount: offer.salaryAmount,
          salaryCurrency: offer.salaryCurrency,
          salaryPeriod: offer.salaryPeriod,
        },
      },
    })

    return { ok: true as const, data: offer, replaced: replaced.map((r) => r.id) }
  })

  if (!created.ok) return fail(created.code, created.message, created.meta)

  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'OFFER_CREATED',
    targetType: 'offer',
    targetId: created.data.id,
    outcome: 'success',
    metadata: {
      candidateId: created.data.candidateId,
      hiringRequestId: created.data.hiringRequestId,
      salaryAmount: created.data.salaryAmount,
      salaryCurrency: created.data.salaryCurrency,
      salaryPeriod: created.data.salaryPeriod,
      supersededOffers: created.replaced,
    },
  })

  return { ok: true, data: created.data }
}

/**
 * Serializes concurrent offer creations for one candidate.
 *
 * A `SELECT … FOR UPDATE` on the candidate row means a second create for
 * the same candidate waits for the first transaction to commit, and then
 * sees the offer it wrote. Without this the duplicate-offer guard is a
 * read-then-write race (audit P2-30).
 */
async function lockCandidateRow(tx: Prisma.TransactionClient, candidateId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Candidate" WHERE id = ${candidateId} FOR UPDATE`
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
    return fail(
      'INVALID_TRANSITION',
      `Cannot edit an offer in status ${existing.status}. Return it to DRAFT first.`,
    )
  }

  // Audit P2-11 — the vocabulary is validated before the write.
  if (input.salaryPeriod !== undefined) {
    const period = normalizeSalaryPeriod(input.salaryPeriod)
    if (!period) return fail('VALIDATION', unsupportedPeriodMessage(input.salaryPeriod))
    input.salaryPeriod = period
  }
  if (input.salaryCurrency !== undefined) {
    const currency = normalizeSalaryCurrency(input.salaryCurrency)
    if (!currency) return fail('VALIDATION', unsupportedCurrencyMessage(input.salaryCurrency))
    input.salaryCurrency = currency
  }

  // Audit P1-28 — a draft may not be edited outside the published band.
  if (input.salaryAmount !== undefined) {
    const hiringRequest = await db.hiringRequest.findFirst({
      where: { id: existing.hiringRequestId, organizationId: ctx.organizationId },
      select: { salaryMin: true, salaryMax: true, salaryCurrency: true },
    })
    if (hiringRequest) {
      const band = checkSalaryBand(
        input.salaryAmount,
        input.salaryCurrency ?? existing.salaryCurrency,
        input.salaryPeriod ?? existing.salaryPeriod,
        {
          min: hiringRequest.salaryMin,
          max: hiringRequest.salaryMax,
          currency: hiringRequest.salaryCurrency,
        },
      )
      if (!band.ok) {
        return fail('SALARY_BAND_EXCEEDED', band.message ?? 'The salary is outside the published band.')
      }
    }
  }

  const { offerId, ...patch } = input
  const updated = await db.offer.update({
    where: { id: offerId },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.salaryAmount !== undefined ? { salaryAmount: patch.salaryAmount } : {}),
      ...(patch.salaryCurrency !== undefined
        ? { salaryCurrency: patch.salaryCurrency as SalaryCurrency }
        : {}),
      ...(patch.salaryPeriod !== undefined ? { salaryPeriod: patch.salaryPeriod } : {}),
      ...(patch.bonusAmount !== undefined ? { bonusAmount: patch.bonusAmount } : {}),
      ...(patch.equityAmount !== undefined ? { equityAmount: patch.equityAmount } : {}),
      ...(patch.commissionAmount !== undefined ? { commissionAmount: patch.commissionAmount } : {}),
      ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
      ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
      ...(patch.employmentType !== undefined ? { employmentType: patch.employmentType } : {}),
      ...(patch.workArrangement !== undefined ? { workArrangement: patch.workArrangement } : {}),
      ...(patch.probationPeriodDays !== undefined
        ? { probationPeriodDays: patch.probationPeriodDays }
        : {}),
      ...(patch.noticePeriodDays !== undefined ? { noticePeriodDays: patch.noticePeriodDays } : {}),
      ...(patch.vacationDays !== undefined ? { vacationDays: patch.vacationDays } : {}),
      ...(patch.benefits !== undefined ? { benefits: patch.benefits } : {}),
      ...(patch.additionalTerms !== undefined ? { additionalTerms: patch.additionalTerms } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    },
  })

  // Audit P1-13 — the audit trail must answer "who changed what, from
  // what to what". Before this, an edit wrote one Activity row titled
  // "Offer edited" with no values at all.
  const changes = diffCompensation(existing, updated)
  await recordActivity(ctx, {
    type: ActivityType.OFFER_EDITED,
    offerId: updated.id,
    candidateId: updated.candidateId,
    hiringRequestId: updated.hiringRequestId,
    title: 'Offer edited',
    description: summarizeChanges(changes),
    metadata: { changes },
  })
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'OFFER_EDITED',
    targetType: 'offer',
    targetId: updated.id,
    outcome: 'success',
    metadata: { changes, kind: 'offer_terms' },
  })

  return { ok: true, data: updated }
}

/** The compensation-bearing fields that are compared before/after an edit. */
const COMPARED_FIELDS = [
  'title',
  'salaryAmount',
  'salaryCurrency',
  'salaryPeriod',
  'bonusAmount',
  'commissionAmount',
  'equityAmount',
  'startDate',
  'expiresAt',
  'employmentType',
  'workArrangement',
  'probationPeriodDays',
  'noticePeriodDays',
  'vacationDays',
] as const

type ComparedField = (typeof COMPARED_FIELDS)[number]

/** Before/after values for every field an edit actually changed. */
function diffCompensation(before: Offer, after: Offer): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of COMPARED_FIELDS) {
    const from = before[field]
    const to = after[field]
    const fromValue = from instanceof Date ? from.toISOString() : from
    const toValue = to instanceof Date ? to.toISOString() : to
    if (fromValue !== toValue) changes[field] = { from: fromValue ?? null, to: toValue ?? null }
  }
  return changes
}

function summarizeChanges(changes: Record<string, { from: unknown; to: unknown }>): string {
  const entries = Object.entries(changes)
  if (entries.length === 0) return 'No compensation fields changed.'
  return entries
    .map(([field, change]) => `${field}: ${formatValue(change.from)} → ${formatValue(change.to)}`)
    .join('; ')
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '(none)'
  if (typeof value === 'number') return String(value)
  return String(value)
}

// -----------------------------------------------------------------------------
// Letter content
// -----------------------------------------------------------------------------

export interface OfferLetterSections {
  fullText?: string | null
  compensationSection?: string | null
  [key: string]: unknown
}

/**
 * Audit P0-05 — the letter is the artifact the candidate reads, so the
 * letter is what the approval control has to protect.
 *
 *   - The letter can only be edited while the offer is a DRAFT. An
 *     APPROVED or ISSUED offer is locked: return it to DRAFT first
 *     (that path is a deliberate, audited act).
 *   - The money stated in the letter is checked against the offer's own
 *     compensation fields. A letter that says "$250,000" for an offer
 *     approved at $165,000 is refused.
 *
 * Audit P1-19 — a manual save must PRESERVE the AI-generated sections.
 * The caller sends the whole section set; the stored draft keeps the
 * AI metadata (model, prompt version, task id) so the "AI-generated on
 * …" badge stays true.
 */
export async function setOfferDraftContent(
  ctx: Ctx,
  offerId: string,
  draftContent: unknown,
  meta: {
    aiGenerated?: boolean
    aiTaskId?: string | null
    promptVersion?: string | null
    modelUsed?: string | null
  },
): Promise<ServiceResult<Offer>> {
  const existing = await db.offer.findFirst({
    where: { id: offerId, organizationId: ctx.organizationId },
  })
  if (!existing) return fail('OFFER_NOT_FOUND', 'Offer not found.')

  // Audit P0-05 — the letter is locked once the offer leaves DRAFT.
  if (!isEditableStatus(existing.status)) {
    return fail(
      'INVALID_TRANSITION',
      `The offer letter can only be edited while the offer is a DRAFT (this offer is ${existing.status}). ` +
        'Return it to DRAFT first if it must change — that is a separate, audited step.',
    )
  }

  // Audit P0-05 — the compensation stated in the letter must match the
  // approved compensation fields.
  const sections = (draftContent ?? {}) as OfferLetterSections
  const consistency = checkCompensationConsistent(
    {
      salaryAmount: existing.salaryAmount,
      salaryCurrency: existing.salaryCurrency,
      bonusAmount: existing.bonusAmount,
      commissionAmount: existing.commissionAmount,
    },
    [
      typeof sections.compensationSection === 'string' ? sections.compensationSection : null,
      typeof sections.fullText === 'string' ? sections.fullText : null,
    ],
  )
  if (!consistency.ok) {
    return fail('COMPENSATION_MISMATCH', consistency.message ?? 'The letter does not match the offer terms.')
  }

  const updated = await db.offer.update({
    where: { id: offerId },
    data: {
      draftContent: draftContent as never,
      ...(meta.aiGenerated ? { aiGeneratedAt: new Date() } : {}),
      ...(meta.aiTaskId ? { aiTaskId: meta.aiTaskId } : {}),
      ...(meta.promptVersion ? { aiPromptVersion: meta.promptVersion } : {}),
      ...(meta.modelUsed ? { aiModelUsed: meta.modelUsed } : {}),
    },
  })

  // Audit P1-13 — a manual letter save is an EDIT and must be visible
  // in the audit trail, with the before/after content.
  const before = (existing.draftContent ?? {}) as OfferLetterSections
  const changedSections = diffSections(before, sections)
  await recordActivity(ctx, {
    type: ActivityType.OFFER_EDITED,
    offerId: updated.id,
    candidateId: updated.candidateId,
    hiringRequestId: updated.hiringRequestId,
    title: meta.aiGenerated ? 'AI offer letter draft generated' : 'Offer letter edited',
    description: summarizeChanges(changedSections),
    metadata: { changes: changedSections, aiGenerated: !!meta.aiGenerated, kind: 'offer_letter' },
  })
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: meta.aiGenerated ? 'OFFER_DRAFT_GENERATED' : 'OFFER_EDITED',
    targetType: 'offer',
    targetId: updated.id,
    outcome: 'success',
    metadata: {
      changes: changedSections,
      aiGenerated: !!meta.aiGenerated,
      modelUsed: meta.modelUsed ?? null,
      promptVersion: meta.promptVersion ?? null,
    },
  })

  return { ok: true, data: updated }
}

/** Before/after for the letter sections that changed. */
function diffSections(
  before: OfferLetterSections,
  after: OfferLetterSections,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  for (const key of keys) {
    if (key === 'fullText') continue
    const from = before?.[key]
    const to = after?.[key]
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
      changes[key] = { from: from ?? null, to: to ?? null }
    }
  }
  return changes
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
  if (!isEditableStatus(offer.status)) {
    return fail(
      'INVALID_TRANSITION',
      `Cannot regenerate the letter of an offer in status ${offer.status}. Return it to DRAFT first.`,
    )
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
    // Finalizes the reservation on success; releases it (then rethrows into
    // the catch below) on any engine failure.
    const result = await runWithAiReservation(
      quotaCheck,
      () => engine.generateOfferLetter(facts),
      (r) => ({ tokensIn: r.usage.inputTokens, tokensOut: r.usage.outputTokens }),
    )
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
    return fail(
      'AI_UNAVAILABLE',
      'AI offer-letter generation is currently unavailable. You can still write the offer letter manually.',
    )
  }

  // Audit P1-19 — the generated letter must survive a reload. The AI
  // output has structured sections; the editor reads `fullText`, so the
  // rendered text is stored alongside the sections.
  const fullText = renderSectionsToText(draft as unknown as Record<string, unknown>)
  const stored = { ...(draft as unknown as Record<string, unknown>), fullText }

  await db.offer.update({
    where: { id: offer.id },
    data: {
      draftContent: stored as any,
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

  return { ok: true, data: { draft: stored as unknown as OfferLetterOutput, taskId: aiTask.id, model: modelUsed } }
}

/** The section order used to render the AI letter into plain text. */

// -----------------------------------------------------------------------------
// Workflow transitions
// -----------------------------------------------------------------------------

type OfferAuditAction =
  | 'OFFER_SUBMITTED_FOR_APPROVAL'
  | 'OFFER_RETURNED_FOR_CHANGES'
  | 'OFFER_APPROVED'
  | 'OFFER_SELF_APPROVED_BY_ADMIN'
  | 'OFFER_ISSUED'
  | 'OFFER_ACCEPTED'
  | 'OFFER_DECLINED'
  | 'OFFER_WITHDRAWN'
  | 'OFFER_EXPIRED'
  | 'OFFER_EDITED'
  | 'OFFER_CREATED'

/**
 * Validates a transition against the state machine, then persists it.
 * Returns the new offer on success. Writes Activity + AuditLog.
 */
async function transition(
  ctx: Ctx,
  offerId: string,
  to: OfferStatus,
  activityType: ActivityType,
  auditAction: OfferAuditAction,
  extraPatch: Record<string, unknown> = {},
  extraMeta: Record<string, unknown> = {},
  activityTitleOverride?: string,
): Promise<ServiceResult<Offer>> {
  const loaded = await loadOfferContext(ctx, offerId)
  if (!loaded.ok) return loaded
  const existing = loaded.data.offer

  const scope = assertRequisitionScope(ctx, loaded.data.hiringRequest)
  if (!scope.ok) return scope

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
    title: activityTitleOverride ?? activityTitle(activityType),
    metadata: extraMeta,
  })
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: auditAction,
    targetType: 'offer',
    targetId: updated.id,
    outcome: 'success',
    metadata: { from: existing.status, to, ...extraMeta },
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
 *     are the only approver in the org (last-resort escape hatch).
 *   - When the escape hatch fires, the SELF-APPROVAL is persisted in the
 *     Activity metadata (`selfApproved: true`), the audit log records
 *     `OFFER_SELF_APPROVED_BY_ADMIN`, and the offer detail page shows a
 *     "self-approved" badge (derived from `approvedById === createdById`).
 *     There is no `aiPromptVersion: 'SELF_APPROVED'` marker: the prompt
 *     version column describes the AI prompt, not the approval, and
 *     overwriting it would lose the real prompt version.
 *
 * Audit P1-09 — the approver pool is ADMIN, TA_LEAD **and**
 * HIRING_MANAGER. A recruiter who created the offer cannot approve it
 * while a hiring manager exists who could.
 *
 * Audit P1-28 — an offer outside the requisition's salary band is
 * APPROVED but carries a warning, so the approver is told what they are
 * signing off.
 */
export async function approveOffer(
  ctx: Ctx,
  offerId: string,
  confirm: boolean,
): Promise<ServiceResult<Offer> & { warning?: string }> {
  if (!confirm) return fail('VALIDATION', 'Approval requires explicit human confirmation.')
  const loaded = await loadOfferContext(ctx, offerId)
  if (!loaded.ok) return loaded
  const existing = loaded.data.offer

  const scope = assertRequisitionScope(ctx, loaded.data.hiringRequest)
  if (!scope.ok) return scope

  // Audit P1-28 — the band warning travels with the approval.
  const band = checkSalaryBand(
    existing.salaryAmount,
    existing.salaryCurrency,
    existing.salaryPeriod,
    {
      min: loaded.data.hiringRequest.salaryMin,
      max: loaded.data.hiringRequest.salaryMax,
      currency: loaded.data.hiringRequest.salaryCurrency,
    },
  )
  const warning = band.ok ? undefined : band.message

  // Approval separation
  if (existing.createdById === ctx.userId) {
    // Check if there is another approver who could approve instead.
    // Audit P1-09 — HIRING_MANAGER can approve, so it counts here.
    const otherApprovers = await db.user.count({
      where: {
        organizationId: ctx.organizationId,
        id: { not: ctx.userId },
        role: { in: ['ADMIN', 'TA_LEAD', 'HIRING_MANAGER'] as never[] },
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
      {
        selfApproved: true,
        reason: 'no_other_approver_available',
      },
      // Visible in the offer timeline: the reviewer can see at a glance
      // that nobody else was available to approve this offer.
      'Offer self-approved (no other approver available)',
    )
    if (!updated.ok) return updated
    return warning ? { ...updated, warning } : updated
  }
  const updated = await transition(
    ctx,
    offerId,
    OfferStatus.APPROVED,
    ActivityType.OFFER_APPROVED,
    'OFFER_APPROVED',
    { approvedById: ctx.userId, approvedAt: new Date() },
    warning ? { salaryBandWarning: warning } : {},
  )
  if (!updated.ok) return updated
  return warning ? { ...updated, warning } : updated
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

/**
 * Audit P1-03 — withdraw an offer that has been APPROVED but not yet
 * issued. Before this, APPROVED was a one-way dead end: an offer whose
 * budget was pulled stayed APPROVED forever, blocking a replacement
 * offer and never reaching the accepted/declined metrics.
 */
export async function withdrawOffer(
  ctx: Ctx,
  offerId: string,
  reason: string,
): Promise<ServiceResult<Offer>> {
  if (!reason || !reason.trim()) {
    return fail('VALIDATION', 'Withdrawal requires a reason.')
  }
  return transition(
    ctx,
    offerId,
    OfferStatus.WITHDRAWN,
    ActivityType.OFFER_WITHDRAWN,
    'OFFER_WITHDRAWN',
    { withdrawnAt: new Date(), withdrawnReason: reason },
    { reason },
  )
}

/**
 * Audit P1-03 / P1-04 — expire an offer. The expiry date must have
 * passed: an offer cannot be expired months early (that is a
 * withdrawal, and the two are audited differently).
 */
export async function expireOffer(
  ctx: Ctx,
  offerId: string,
  options: { reason?: string } = {},
): Promise<ServiceResult<Offer>> {
  const loaded = await loadOfferContext(ctx, offerId)
  if (!loaded.ok) return loaded
  const existing = loaded.data.offer
  if (!existing.expiresAt || existing.expiresAt.getTime() > Date.now()) {
    return fail(
      'VALIDATION',
      'This offer has not expired yet. Use "Withdraw offer" if it has to be pulled early.',
    )
  }
  return transition(
    ctx,
    offerId,
    OfferStatus.EXPIRED,
    ActivityType.OFFER_EXPIRED,
    'OFFER_EXPIRED',
    { expiredAt: new Date() },
    { reason: options.reason ?? 'Offer expiry date passed' },
  )
}

/**
 * Audit P1-02 — cancel a DRAFT offer.
 *
 * A draft that is abandoned used to sit in DRAFT forever: DRAFT is an
 * active status, so it blocked a replacement offer for the same
 * candidate and showed up in the "Draft" metric forever. Cancelling
 * removes the draft (nothing was ever sent to a candidate) and records
 * the cancellation in the audit trail.
 */
export async function cancelDraftOffer(
  ctx: Ctx,
  offerId: string,
  reason: string,
): Promise<ServiceResult<{ id: string; cancelled: true }>> {
  const loaded = await loadOfferContext(ctx, offerId)
  if (!loaded.ok) return loaded
  if (loaded.data.offer.status !== OfferStatus.DRAFT) {
    return fail(
      'INVALID_TRANSITION',
      `Only a DRAFT offer can be cancelled (this offer is ${loaded.data.offer.status}).`,
    )
  }
  const scope = assertRequisitionScope(ctx, loaded.data.hiringRequest)
  if (!scope.ok) return scope

  const { offer, candidate, hiringRequest } = loaded.data
  await db.offer.delete({ where: { id: offer.id } })
  // The Activity row deliberately carries no offerId: the offer row is
  // gone and the FK would cascade the row away with it.
  await db.activity.create({
    data: {
      organizationId: ctx.organizationId,
      type: ActivityType.OFFER_WITHDRAWN,
      actorId: ctx.userId,
      candidateId: candidate.id,
      hiringRequestId: hiringRequest.id,
      title: 'Offer draft cancelled',
      description: reason || 'The draft was cancelled.',
      metadata: { cancelledOfferId: offer.id, reason: reason || null },
    },
  })
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'OFFER_WITHDRAWN',
    targetType: 'offer',
    targetId: offer.id,
    outcome: 'success',
    reason: reason || 'draft_cancelled',
    metadata: { cancelled: true, candidateId: candidate.id, hiringRequestId: hiringRequest.id },
  })
  return { ok: true, data: { id: offer.id, cancelled: true } }
}

/**
 * Records a candidate's answer to an offer.
 *
 * Audit P0-01 / P0-02 — an ACCEPTED offer HIRES the candidate. The
 * whole hire (offer status, candidate stage, `hiredAt`,
 * `HiringRequest.filled`, requisition status) commits in ONE
 * transaction, so a crash can never leave a candidate hired with
 * `filled` still at zero.
 *
 * Audit P1-04 — an offer whose expiry date has passed can no longer be
 * accepted, and an offer can only be EXPIRED once its date has passed.
 */
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

  const loaded = await loadOfferContext(ctx, offerId)
  if (!loaded.ok) return loaded
  const { offer, candidate, hiringRequest } = loaded.data

  const scope = assertRequisitionScope(ctx, hiringRequest)
  if (!scope.ok) return scope

  const now = new Date()
  if (response === 'ACCEPTED' && offer.expiresAt && offer.expiresAt.getTime() < now.getTime()) {
    return fail(
      'ALREADY_TERMINAL',
      `This offer expired on ${offer.expiresAt.toISOString()} and can no longer be accepted.`,
    )
  }
  if (response === 'EXPIRED' && (!offer.expiresAt || offer.expiresAt.getTime() > now.getTime())) {
    return fail(
      'VALIDATION',
      'This offer has not expired yet. Use "Withdraw offer" if it has to be pulled early.',
    )
  }

  const targetStatus = response as OfferStatus
  const extraPatch: Record<string, unknown> = { respondedAt: now }
  let activityType: ActivityType
  let auditAction: 'OFFER_ACCEPTED' | 'OFFER_DECLINED' | 'OFFER_WITHDRAWN' | 'OFFER_EXPIRED'
  switch (response) {
    case 'ACCEPTED':
      extraPatch.acceptedAt = now
      activityType = ActivityType.OFFER_ACCEPTED
      auditAction = 'OFFER_ACCEPTED'
      break
    case 'DECLINED':
      extraPatch.declinedAt = now
      if (options.reason) extraPatch.declineReason = options.reason
      activityType = ActivityType.OFFER_DECLINED
      auditAction = 'OFFER_DECLINED'
      break
    case 'WITHDRAWN':
      extraPatch.withdrawnAt = now
      if (options.reason) extraPatch.withdrawnReason = options.reason
      activityType = ActivityType.OFFER_WITHDRAWN
      auditAction = 'OFFER_WITHDRAWN'
      break
    case 'EXPIRED':
      extraPatch.expiredAt = now
      activityType = ActivityType.OFFER_EXPIRED
      auditAction = 'OFFER_EXPIRED'
      break
  }

  if (response === 'ACCEPTED') {
    return acceptOffer(ctx, offer, candidate, hiringRequest, extraPatch, options)
  }

  // Every other answer takes the candidate OUT of the OFFER stage — a
  // declined offer must not leave the candidate sitting in OFFER with no
  // live offer (audit A26).
  const candidateResult = await db.$transaction(async (tx) => {
    const staged = await tx.candidate.findFirst({
      where: { id: candidate.id, organizationId: ctx.organizationId },
      select: { id: true, stage: true, hiringRequestId: true },
    })
    if (!staged || staged.stage !== 'OFFER') {
      return { ok: true as const, moved: false }
    }
    // OFFER → REJECTED (the candidate said no) / WITHDRAWN (the company
    // pulled it). Both are legal moves out of OFFER.
    const toStage = response === 'DECLINED' ? 'REJECTED' : 'WITHDRAWN'
    const moved = await transitionCandidateStage(tx, {
      candidateId: candidate.id,
      toStage,
      actorId: ctx.userId,
      reason: options.reason ?? `Offer ${response.toLowerCase()}`,
    })
    if (!moved.ok) return { ok: false as const, error: moved.error }
    // Keep the `status` mirror in step with the stage (audit P1-27).
    await syncCandidateStatus(tx, candidate.id, toStage)
    // Re-derive the requisition counter from the pipeline (audit P0-02):
    // a candidate leaving the pipeline changes the truth, so the stored
    // counter is recomputed here — in the same transaction as the stage
    // write. This is what stops the counter from drifting for good.
    if (staged.hiringRequestId) {
      await syncHiringRequestFilled(tx, staged.hiringRequestId)
    }
    return { ok: true as const, moved: true, toStage }
  })
  if (!candidateResult.ok) {
    return fail('INVALID_TRANSITION', candidateResult.error.message)
  }

  const updated = await transition(
    ctx,
    offerId,
    targetStatus,
    activityType,
    auditAction,
    extraPatch,
    { reason: options.reason ?? null },
  )
  return updated
}

/**
 * Audit P0-01 / P0-02 — the hire.
 *
 * One transaction commits:
 *   - the offer's new status (ACCEPTED),
 *   - the candidate's stage (HIRED) and `hiredAt`,
 *   - `HiringRequest.filled`,
 *   - the requisition status (FILLED once the openings are filled),
 *   - the Activity rows (OFFER_ACCEPTED + HIRED).
 *
 * `HiringRequest.filled` is DERIVED, never accumulated (audit P0-02,
 * A46): it always equals the number of candidates actually in stage HIRED
 * on the requisition.
 *
 * The audit's A23 ("an ACCEPTED offer response increments
 * `HiringRequest.filled` by exactly 1") is satisfied by that derivation,
 * not by a separate increment: the candidate moves OFFER → HIRED inside
 * this same transaction, so the real HIRED count — and therefore
 * `filled` — goes up by exactly one. An earlier implementation used
 *
 *     filled = max(filled_before + 1, count(HIRED candidates))
 *
 * which let `filled` sit ONE ABOVE the real hire count whenever an offer
 * was accepted for a candidate who had already been hired by another
 * path. That is precisely the drift P0-02 exists to remove.
 *
 * EVERY pipeline write — a manual stage move, a bulk move, an offer
 * acceptance, a decline, an expiry — re-derives the counter from the
 * pipeline through `syncHiringRequestFilled` (see
 * `lib/hiring-requests/capacity.ts`). That single writer is what keeps
 * the counter from drifting.
 */
async function acceptOffer(
  ctx: Ctx,
  offer: Offer,
  candidate: OfferContext['candidate'],
  hiringRequest: OfferContext['hiringRequest'],
  extraPatch: Record<string, unknown>,
  options: { reason?: string; confirm?: boolean },
): Promise<ServiceResult<Offer>> {
  const result = await db.$transaction(async (tx) => {
    // Re-read inside the transaction: the offer may have moved on
    // between the pre-check and the write.
    const current = await tx.offer.findFirst({
      where: { id: offer.id, organizationId: ctx.organizationId },
    })
    if (!current) {
      return {
        ok: false as const,
        code: 'OFFER_NOT_FOUND' as const,
        message: 'Offer not found.',
      }
    }

    const validation = validateTransition(current.status, OfferStatus.ACCEPTED)
    if (!validation.ok) {
      return {
        ok: false as const,
        code: 'INVALID_TRANSITION' as const,
        message: validation.reason,
        meta: { from: current.status, to: OfferStatus.ACCEPTED },
      }
    }

    // The candidate must be in OFFER (the stage the offer was made
    // from). A candidate who is already HIRED is accepted idempotently
    // — the hire simply already happened.
    const staged = await tx.candidate.findFirst({
      where: { id: candidate.id, organizationId: ctx.organizationId },
      select: { id: true, stage: true, hiredAt: true },
    })
    if (!staged) {
      return {
        ok: false as const,
        code: 'CANDIDATE_NOT_FOUND' as const,
        message: 'Candidate not found.',
      }
    }

    if (staged.stage === 'HIRED') {
      if (!staged.hiredAt) {
        await tx.candidate.update({
          where: { id: staged.id },
          data: { hiredAt: new Date(), lastActivityAt: new Date() },
        })
      }
    } else if (staged.stage !== 'OFFER') {
      return {
        ok: false as const,
        code: 'INVALID_TRANSITION' as const,
        message:
          `The candidate must be in the OFFER stage before this offer can be accepted ` +
          `(current stage: ${staged.stage}). Move the candidate forward first.`,
      }
    } else {
      const moved = await transitionCandidateStage(tx, {
        candidateId: staged.id,
        toStage: 'HIRED',
        actorId: ctx.userId,
        reason: 'Offer accepted',
      })
      if (!moved.ok) {
        return {
          ok: false as const,
          code: 'INVALID_TRANSITION' as const,
          message: moved.error.message,
        }
      }
    }

    // The `Candidate.status` mirror follows the stage (audit P1-27): a
    // hire is `status = HIRED`, not just `stage = HIRED`.
    await syncCandidateStatus(tx, staged.id, 'HIRED')

    // The requisition counter is DERIVED, never accumulated (audit P0-02,
    // A46). We do not "increment filled" here — we hire a person, and
    // `filled` follows the real HIRED count. The previous implementation
    // used `Math.max(requisition.filled + 1, derived)`, which let `filled`
    // sit ONE ABOVE the actual hire count whenever an offer was accepted
    // for a candidate who was already HIRED — exactly the drift P0-02
    // exists to remove, and it would have failed A46.
    //
    // `syncHiringRequestFilled` is the single writer of this column and is
    // called by every other path that changes a candidate's stage, so the
    // counter and the pipeline can never disagree.
    const requisition = await tx.hiringRequest.findFirst({
      where: { id: hiringRequest.id, organizationId: ctx.organizationId },
      select: { id: true, status: true, openings: true, filled: true },
    })
    if (!requisition) {
      return {
        ok: false as const,
        code: 'HIRING_REQUEST_NOT_FOUND' as const,
        message: 'Hiring request not found.',
      }
    }
    const filled = await syncHiringRequestFilled(tx, requisition.id)

    // When every opening is filled the requisition becomes FILLED.
    if (requisition && filled >= requisition.openings) {
      const hrValidation = validateHiringRequestTransition(
        requisition.status,
        HiringRequestStatus.FILLED,
      )
      if (hrValidation.ok) {
        await tx.hiringRequest.update({
          where: { id: requisition.id },
          data: { status: HiringRequestStatus.FILLED, closedAt: new Date() },
        })
      }
    }

    const updated = await tx.offer.update({
      where: { id: offer.id },
      data: { status: OfferStatus.ACCEPTED, ...extraPatch },
    })

    await tx.activity.create({
      data: {
        organizationId: ctx.organizationId,
        type: ActivityType.OFFER_ACCEPTED,
        actorId: ctx.userId,
        offerId: updated.id,
        candidateId: updated.candidateId,
        hiringRequestId: updated.hiringRequestId,
        title: 'Offer accepted',
        description: options.reason ?? null,
        metadata: { filled },
      },
    })
    await tx.activity.create({
      data: {
        organizationId: ctx.organizationId,
        type: ActivityType.HIRED,
        actorId: ctx.userId,
        offerId: updated.id,
        candidateId: updated.candidateId,
        hiringRequestId: updated.hiringRequestId,
        title: 'Candidate hired',
        description: 'The candidate accepted the offer.',
        metadata: { offerId: updated.id, filled },
      },
    })

    // The audit trail commits WITH the hire: a crash can never leave a
    // candidate hired with no trail (audit P1-14). `recordAuditLog` is
    // best-effort by design and cannot join a transaction, so the rows
    // are written directly here with the transaction client.
    await tx.auditLog.create({
      data: {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: 'OFFER_ACCEPTED',
        targetType: 'offer',
        targetId: updated.id,
        outcome: 'success',
        metadata: {
          candidateId: updated.candidateId,
          hiringRequestId: updated.hiringRequestId,
          filled,
          hired: true,
        },
      },
    })
    await tx.auditLog.create({
      data: {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: 'CANDIDATE_STAGE_CHANGED',
        targetType: 'candidate',
        targetId: updated.candidateId,
        outcome: 'success',
        metadata: {
          from: 'OFFER',
          to: 'HIRED',
          reason: 'Offer accepted',
          offerId: updated.id,
        },
      },
    })

    return { ok: true as const, data: updated, filled }
  })

  if (!result.ok) return fail(result.code, result.message, result.meta)

  return { ok: true, data: result.data }
}

// -----------------------------------------------------------------------------
// Activity writer
// -----------------------------------------------------------------------------

async function recordActivity(
  ctx: Ctx,
  input: {
    type: ActivityType
    offerId: string
    candidateId: string
    hiringRequestId: string
    title: string
    description?: string
    metadata?: Record<string, unknown>
  },
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
        metadata: (input.metadata ?? {}) as never,
      },
    })
  } catch {
    /* activity writes are best-effort; the offer transition is the source of truth */
  }
}
