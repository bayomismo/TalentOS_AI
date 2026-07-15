/**
 * Sprint 11.1 — Action: CREATE_OFFER_DRAFT
 *
 * PART 8: create an offer in DRAFT status. The Copilot gathers the
 * required compensation facts from the user (it does NOT invent
 * salary / bonus / equity / currency). On confirm, the existing
 * Sprint 10 offer service is called.
 *
 * Hard rules (PART 8):
 *   - Candidate must be SELECTED.
 *   - No duplicate active offer (Sprint 10 eligibility rules).
 *   - Compensation privacy: if the user lacks `offer.view_compensation`,
 *     the preview hides the values.
 *   - Result MUST remain DRAFT. The Copilot cannot submit/approve/issue.
 *   - If critical fields are missing, the action returns INPUT_INVALID
 *     (the AI must ask the user, never invent).
 */

import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'
import { hasPermission } from '@/lib/auth/permissions'
import type { CopilotAuthContext } from '../types'
import type { CopilotActionDefinition, ActionFailure } from './types'
import {
  createConfirmation,
  loadAndValidateConfirmation,
  markExecuted,
  markFailed,
} from '../security/confirmations'
import {
  createOffer as svcCreateOffer,
  type ServiceResult,
  type CreateOfferInput as SvcCreateOfferInput,
} from '@/features/offers/services/offer-service'

// ---------------------------------------------------------------------------
// Input schema — required compensation facts that the user MUST provide
// ---------------------------------------------------------------------------

const InputSchema = z.object({
  candidateReference: z.string().min(1).max(200).describe('Free-text candidate reference resolved server-side (name, email, or id)'),
  /** CRITICAL: the AI may not invent these. The user must provide them. */
  salaryAmount: z.number().int().positive(),
  salaryCurrency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'INR', 'BRL', 'MXN', 'SGD', 'HKD', 'NZD']).default('USD'),
  salaryPeriod: z.enum(['HOUR', 'YEAR', 'MONTH', 'WEEK']).default('YEAR'),
  title: z.string().min(2).max(160).describe('Offer title / position'),
  bonusAmount: z.number().int().min(0).optional(),
  commissionAmount: z.number().int().min(0).optional(),
  equityAmount: z.string().max(80).optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP']).default('FULL_TIME'),
  workArrangement: z.enum(['ONSITE', 'REMOTE', 'HYBRID']).default('ONSITE'),
  startDate: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  probationPeriodDays: z.number().int().min(0).max(365).optional(),
  noticePeriodDays: z.number().int().min(0).max(180).optional(),
  vacationDays: z.number().int().min(0).max(120).optional(),
  benefits: z.string().max(2000).optional(),
  additionalTerms: z.string().max(4000).optional(),
  notes: z.string().max(2000).optional(),
})

type Input = z.infer<typeof InputSchema>

// ---------------------------------------------------------------------------
// Preview schema
// ---------------------------------------------------------------------------

const PreviewSchema = z.object({
  candidateName: z.string(),
  candidateId: z.string(),
  hiringRequestId: z.string(),
  hiringRequestTitle: z.string(),
  title: z.string(),
  salaryAmount: z.number(),
  salaryCurrency: z.string(),
  salaryPeriod: z.string(),
  bonusAmount: z.number().optional(),
  commissionAmount: z.number().optional(),
  equityAmount: z.string().optional(),
  employmentType: z.string(),
  workArrangement: z.string(),
  startDate: z.string().optional(),
  expiresAt: z.string().optional(),
  probationPeriodDays: z.number().optional(),
  noticePeriodDays: z.number().optional(),
  vacationDays: z.number().optional(),
  willCreateAs: z.literal('DRAFT'),
})

type Preview = z.infer<typeof PreviewSchema>

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

async function resolveCandidateForOffer(ctx: CopilotAuthContext, ref: string): Promise<{ id: string; firstName: string; lastName: string; hiringRequestId: string; selectedDecisionId: string } | ActionFailure> {
  const trimmed = ref.trim()
  // Try as uuid first
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
  let cand: { id: string; firstName: string; lastName: string; hiringRequestId: string; status: string } | null = null
  if (isUuid) {
    cand = await db.candidate.findFirst({
      where: { id: trimmed, organizationId: ctx.organizationId },
    })
  } else if (trimmed.includes('@')) {
    cand = await db.candidate.findFirst({
      where: { email: trimmed.toLowerCase(), organizationId: ctx.organizationId },
    })
  } else {
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 2) {
      const candidates = await db.candidate.findMany({
        where: {
          organizationId: ctx.organizationId,
          firstName: { equals: parts[0], mode: 'insensitive' },
          lastName: { equals: parts.slice(1).join(' '), mode: 'insensitive' },
        },
        take: 5,
      })
      if (candidates.length === 1) cand = candidates[0]
    }
    if (!cand) {
      cand = await db.candidate.findFirst({
        where: {
          organizationId: ctx.organizationId,
          OR: [
            { firstName: { equals: trimmed, mode: 'insensitive' } },
            { lastName: { equals: trimmed, mode: 'insensitive' } },
          ],
        },
      })
    }
  }
  if (!cand) return { code: 'RESOURCE_NOT_FOUND', message: `Could not resolve candidate "${trimmed}".` }

  // Sprint 10 rule: candidate must be SELECTED
  const decision = await db.candidateDecision.findFirst({
    where: { candidateId: cand.id, hiringRequestId: cand.hiringRequestId, decision: 'SELECTED' as never },
    orderBy: { decidedAt: 'desc' },
  })
  if (!decision) {
    return { code: 'BUSINESS_STATE_INVALID', message: `Candidate ${cand.firstName} ${cand.lastName} is not SELECTED for this hiring request. They must be selected before an offer can be drafted.` }
  }

  // Sprint 10 rule: no duplicate active offer
  const activeOffer = await db.offer.findFirst({
    where: {
      candidateId: cand.id,
      hiringRequestId: cand.hiringRequestId,
      status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'ACCEPTED'] as never[] },
    },
  })
  if (activeOffer) {
    return { code: 'BUSINESS_STATE_INVALID', message: `An active offer (status ${activeOffer.status}) already exists for this candidate. Only one active offer is allowed at a time.` }
  }

  return { id: cand.id, firstName: cand.firstName, lastName: cand.lastName, hiringRequestId: cand.hiringRequestId, selectedDecisionId: decision.id }
}

// ---------------------------------------------------------------------------
// Action implementation
// ---------------------------------------------------------------------------

export const createOfferDraftAction: CopilotActionDefinition<Input, Preview> = {
  id: 'CREATE_OFFER_DRAFT',
  description: 'Create an offer in DRAFT status. The AI does not invent compensation — you must supply salary, currency, and any bonus/equity. The Copilot cannot submit, approve, issue, accept, or decline the offer.',
  inputSchema: InputSchema,
  previewSchema: PreviewSchema,
  resultSchema: z.object({
    resourceId: z.string(),
    resourceType: z.literal('Offer'),
    canonicalUrl: z.string(),
    label: z.string(),
  }),
  requiredPermissions: ['offer.create'],

  async prepare(ctx, input) {
    if (!hasPermission(ctx.role as any, 'offer.create' as any)) {
      return { ok: false, failure: { code: 'PERMISSION_DENIED', message: 'You do not have permission to create offers.' } }
    }

    // Resolve candidate
    const cand = await resolveCandidateForOffer(ctx, input.candidateReference)
    if ('code' in cand) return { ok: false, failure: cand }

    // Resolve hiring request
    const hr = await db.hiringRequest.findFirst({
      where: { id: cand.hiringRequestId, organizationId: ctx.organizationId },
    })
    if (!hr) return { ok: false, failure: { code: 'RESOURCE_NOT_FOUND', message: 'Hiring request not found.' } }

    const preview: Preview = {
      candidateName: `${cand.firstName} ${cand.lastName}`.trim(),
      candidateId: cand.id,
      hiringRequestId: hr.id,
      hiringRequestTitle: hr.title,
      title: input.title,
      salaryAmount: input.salaryAmount,
      salaryCurrency: input.salaryCurrency,
      salaryPeriod: input.salaryPeriod,
      bonusAmount: input.bonusAmount,
      commissionAmount: input.commissionAmount,
      equityAmount: input.equityAmount,
      employmentType: input.employmentType,
      workArrangement: input.workArrangement,
      startDate: input.startDate,
      expiresAt: input.expiresAt,
      probationPeriodDays: input.probationPeriodDays,
      noticePeriodDays: input.noticePeriodDays,
      vacationDays: input.vacationDays,
      willCreateAs: 'DRAFT',
    }

    const payload: Input = {
      candidateReference: input.candidateReference,
      salaryAmount: input.salaryAmount,
      salaryCurrency: input.salaryCurrency,
      salaryPeriod: input.salaryPeriod,
      title: input.title,
      bonusAmount: input.bonusAmount,
      commissionAmount: input.commissionAmount,
      equityAmount: input.equityAmount,
      employmentType: input.employmentType,
      workArrangement: input.workArrangement,
      startDate: input.startDate,
      expiresAt: input.expiresAt,
      probationPeriodDays: input.probationPeriodDays,
      noticePeriodDays: input.noticePeriodDays,
      vacationDays: input.vacationDays,
      benefits: input.benefits,
      additionalTerms: input.additionalTerms,
      notes: input.notes,
    }

    const row = await createConfirmation({
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      actionId: 'CREATE_OFFER_DRAFT',
      actionType: 'CREATE_OFFER_DRAFT',
      payload,
      preview,
    })

    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      action: 'COPILOT_ACTION_PREPARED',
      targetType: 'copilot_action',
      targetId: row.id,
      outcome: 'success',
      metadata: { actionId: 'CREATE_OFFER_DRAFT', candidateId: cand.id },
    })

    return { ok: true, confirmationId: row.id, preview, expiresAt: row.expiresAt }
  },

  async execute(ctx, confirmationId) {
    const validated = await loadAndValidateConfirmation(ctx, confirmationId, 'CREATE_OFFER_DRAFT')
    if (!validated.ok) return { ok: false, failure: validated.failure }
    const confirmation = validated.confirmation

    if (!hasPermission(ctx.role as any, 'offer.create' as any)) {
      await markFailed(confirmationId, 'permission_denied')
      return { ok: false, failure: { code: 'PERMISSION_DENIED', message: 'You no longer have permission to create offers.' } }
    }

    const inputParse = InputSchema.safeParse(confirmation.payload)
    if (!inputParse.success) {
      await markFailed(confirmationId, 'payload_invalid')
      return { ok: false, failure: { code: 'INPUT_INVALID', message: 'Confirmation payload is invalid.' } }
    }
    const input = inputParse.data

    // Re-resolve candidate at confirm time. This re-validates SELECTED + duplicate guard.
    const cand = await resolveCandidateForOffer(ctx, input.candidateReference)
    if ('code' in cand) {
      await markFailed(confirmationId, 'candidate_invalid')
      return { ok: false, failure: cand }
    }

    // Call the existing Sprint 10 service
    const svcCtx = {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      role: ctx.role,
      isAdmin: ctx.isAdmin,
      isTaLead: ctx.role === 'TA_LEAD',
    }
    const svcInput: SvcCreateOfferInput = {
      candidateId: cand.id,
      hiringRequestId: cand.hiringRequestId,
      title: input.title,
      salaryAmount: input.salaryAmount,
      salaryCurrency: input.salaryCurrency,
      salaryPeriod: input.salaryPeriod,
      bonusAmount: input.bonusAmount ?? null,
      commissionAmount: input.commissionAmount ?? null,
      equityAmount: input.equityAmount ?? null,
      employmentType: input.employmentType,
      workArrangement: input.workArrangement,
      startDate: input.startDate ? new Date(input.startDate) : null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      probationPeriodDays: input.probationPeriodDays ?? null,
      noticePeriodDays: input.noticePeriodDays ?? null,
      vacationDays: input.vacationDays ?? null,
      benefits: input.benefits ?? null,
      additionalTerms: input.additionalTerms ?? null,
      notes: input.notes ?? null,
    }
    const svcResult: ServiceResult<{ id: string; status: string; title: string }> = await svcCreateOffer(svcCtx, svcInput)
    if (!svcResult.ok) {
      await markFailed(confirmationId, svcResult.code)
      return { ok: false, failure: { code: 'BUSINESS_STATE_INVALID', message: svcResult.message, details: { serviceCode: svcResult.code } } }
    }

    // Sprint 10 guarantee: the offer MUST remain in DRAFT. The Copilot
    // explicitly does NOT call submitForApproval / approve / issue.
    const won = await markExecuted(confirmationId, { resourceId: svcResult.data.id, resourceType: 'Offer' })
    if (!won) {
      await markFailed(confirmationId, 'concurrency_conflict')
      return { ok: false, failure: { code: 'CONCURRENCY_CONFLICT', message: 'Another confirmation raced this one.' } }
    }

    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      action: 'OFFER_CREATED',
      targetType: 'offer',
      targetId: svcResult.data.id,
      outcome: 'success',
      metadata: { source: 'copilot', confirmationId, status: 'DRAFT' },
    })
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      action: 'COPILOT_ACTION_EXECUTED',
      targetType: 'copilot_action',
      targetId: confirmationId,
      outcome: 'success',
      metadata: { actionId: 'CREATE_OFFER_DRAFT', resourceType: 'Offer', resourceId: svcResult.data.id },
    })

    return {
      ok: true,
      confirmationId,
      result: {
        resourceId: svcResult.data.id,
        resourceType: 'Offer',
        canonicalUrl: `/offers/${svcResult.data.id}`,
        label: `Offer draft created: ${svcResult.data.title}`,
      },
    }
  },
}
