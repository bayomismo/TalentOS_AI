/**
 * Sprint 11.1 — Action: SCHEDULE_INTERVIEW
 *
 * PART 7: schedule a new interview. The Copilot resolves the
 * candidate, the hiring request, the interviewer(s), and the
 * date/time. It validates all of them at PREPARE and re-validates
 * at CONFIRM.
 *
 * Hard rules:
 *   - Candidate must belong to the same org.
 *   - All interviewers must belong to the same org and have
 *     `interview.evaluate` permission.
 *   - The scheduled time must be in the future.
 *   - On confirm, the existing Interview domain service is used.
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

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

function caseInsensitiveEnum<T extends [string, ...string[]]>(values: T) {
  return z.preprocess(
    (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    z.enum(values),
  )
}

const InputSchema = z.object({
  candidateReference: z.string().min(1).max(200).describe('Free-text candidate reference resolved server-side (name, email, or id)'),
  type: caseInsensitiveEnum(['PHONE_SCREEN', 'TECHNICAL', 'BEHAVIORAL', 'PANEL', 'ONSITE', 'FINAL', 'CULTURE_FIT', 'CASE_STUDY']).default('TECHNICAL'),
  scheduledAt: z.string().datetime().describe('ISO 8601 timestamp in UTC'),
  durationMinutes: z.number().int().min(15).max(480).default(60),
  interviewerEmails: z.array(z.string().email()).min(1).max(8),
  notes: z.string().max(2000).optional(),
  timezone: z.string().min(1).max(60).default('UTC'),
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
  type: z.string(),
  scheduledAt: z.string(),
  durationMinutes: z.number(),
  timezone: z.string(),
  participantNames: z.array(z.string()),
  notes: z.string().optional(),
})

type Preview = z.infer<typeof PreviewSchema>

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

async function resolveCandidate(ctx: CopilotAuthContext, ref: string): Promise<{ id: string; firstName: string; lastName: string; hiringRequestId: string } | ActionFailure> {
  const trimmed = ref.trim()
  // Try as uuid first
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
  if (isUuid) {
    const c = await db.candidate.findFirst({
      where: { id: trimmed, organizationId: ctx.organizationId },
    })
    if (c) return { id: c.id, firstName: c.firstName, lastName: c.lastName, hiringRequestId: c.hiringRequestId }
  }
  // Try as email
  if (trimmed.includes('@')) {
    const c = await db.candidate.findFirst({
      where: { email: trimmed.toLowerCase(), organizationId: ctx.organizationId },
    })
    if (c) return { id: c.id, firstName: c.firstName, lastName: c.lastName, hiringRequestId: c.hiringRequestId }
  }
  // Try as "First Last" name search (case-insensitive)
  const parts = trimmed.split(/\s+/)
  if (parts.length >= 2) {
    const first = parts[0]
    const last = parts.slice(1).join(' ')
    const candidates = await db.candidate.findMany({
      where: {
        organizationId: ctx.organizationId,
        firstName: { equals: first, mode: 'insensitive' },
        lastName: { equals: last, mode: 'insensitive' },
      },
      take: 5,
    })
    if (candidates.length === 1) {
      const c = candidates[0]
      return { id: c.id, firstName: c.firstName, lastName: c.lastName, hiringRequestId: c.hiringRequestId }
    }
    if (candidates.length > 1) {
      return { code: 'INPUT_INVALID', message: `Multiple candidates match "${trimmed}". Please use the candidate's email or full name with more specificity.` }
    }
  }
  // Try matching just first or last
  const fallback = await db.candidate.findFirst({
    where: {
      organizationId: ctx.organizationId,
      OR: [
        { firstName: { equals: trimmed, mode: 'insensitive' } },
        { lastName: { equals: trimmed, mode: 'insensitive' } },
      ],
    },
  })
  if (fallback) return { id: fallback.id, firstName: fallback.firstName, lastName: fallback.lastName, hiringRequestId: fallback.hiringRequestId }

  return { code: 'RESOURCE_NOT_FOUND', message: `Could not resolve candidate "${trimmed}". Please use the candidate's email or full name.` }
}

async function resolveInterviewers(ctx: CopilotAuthContext, emails: string[]): Promise<Array<{ id: string; firstName: string; lastName: string }> | ActionFailure> {
  if (emails.length === 0) return { code: 'INPUT_INVALID', message: 'At least one interviewer is required.' }
  const users = await db.user.findMany({
    where: {
      email: { in: emails.map(e => e.toLowerCase()) },
      organizationId: ctx.organizationId,
      status: 'ACTIVE',
    },
  })
  if (users.length !== emails.length) {
    const found = new Set(users.map(u => u.email.toLowerCase()))
    const missing = emails.filter(e => !found.has(e.toLowerCase()))
    return { code: 'RESOURCE_NOT_FOUND', message: `Interviewer(s) not found in this organization: ${missing.join(', ')}` }
  }
  // Validate every interviewer has interview.evaluate permission
  for (const u of users) {
    if (!hasPermission(u.role as any, 'interview.evaluate' as any)) {
      return { code: 'BUSINESS_STATE_INVALID', message: `${u.firstName} ${u.lastName} does not have permission to evaluate interviews and cannot be assigned as an interviewer.` }
    }
  }
  return users.map(u => ({ id: u.id, firstName: u.firstName, lastName: u.lastName }))
}

// ---------------------------------------------------------------------------
// Action implementation
// ---------------------------------------------------------------------------

export const scheduleInterviewAction: CopilotActionDefinition<Input, Preview> = {
  id: 'SCHEDULE_INTERVIEW',
  description: 'Schedule a new interview with one or more interviewers for a candidate. The Copilot does not create the interview before explicit confirmation.',
  inputSchema: InputSchema,
  previewSchema: PreviewSchema,
  resultSchema: z.object({
    resourceId: z.string(),
    resourceType: z.literal('Interview'),
    canonicalUrl: z.string(),
    label: z.string(),
  }),
  requiredPermissions: ['interview.create'],

  async prepare(ctx, input) {
    if (!hasPermission(ctx.role as any, 'interview.create' as any)) {
      return { ok: false, failure: { code: 'PERMISSION_DENIED', message: 'You do not have permission to schedule interviews.' } }
    }

    // Validate time is in the future
    const scheduledAt = new Date(input.scheduledAt)
    if (isNaN(scheduledAt.getTime())) {
      return { ok: false, failure: { code: 'INPUT_INVALID', message: 'scheduledAt is not a valid date.' } }
    }
    if (scheduledAt.getTime() <= Date.now()) {
      return { ok: false, failure: { code: 'INPUT_INVALID', message: 'Interview must be scheduled in the future.' } }
    }

    // Resolve candidate
    const cand = await resolveCandidate(ctx, input.candidateReference)
    if ('code' in cand) return { ok: false, failure: cand }

    // Validate candidate is not in a terminal state
    const fullCandidate = await db.candidate.findFirst({
      where: { id: cand.id, organizationId: ctx.organizationId },
    })
    if (!fullCandidate) return { ok: false, failure: { code: 'RESOURCE_NOT_FOUND', message: 'Candidate not found.' } }
    if (fullCandidate.status !== 'ACTIVE') {
      return { ok: false, failure: { code: 'BUSINESS_STATE_INVALID', message: `Candidate ${fullCandidate.firstName} ${fullCandidate.lastName} is ${fullCandidate.status} and cannot be interviewed.` } }
    }

    // Resolve hiring request
    const hr = await db.hiringRequest.findFirst({
      where: { id: cand.hiringRequestId, organizationId: ctx.organizationId },
    })
    if (!hr) return { ok: false, failure: { code: 'RESOURCE_NOT_FOUND', message: 'Candidate\'s hiring request not found.' } }
    if (hr.status === 'CLOSED' || hr.status === 'CANCELLED') {
      return { ok: false, failure: { code: 'BUSINESS_STATE_INVALID', message: `Hiring request "${hr.title}" is ${hr.status} and cannot accept new interviews.` } }
    }

    // Resolve interviewers
    const interviewers = await resolveInterviewers(ctx, input.interviewerEmails)
    if ('code' in interviewers) return { ok: false, failure: interviewers }

    const preview: Preview = {
      candidateName: `${cand.firstName} ${cand.lastName}`.trim(),
      candidateId: cand.id,
      hiringRequestId: hr.id,
      hiringRequestTitle: hr.title,
      type: input.type,
      scheduledAt: scheduledAt.toISOString(),
      durationMinutes: input.durationMinutes,
      timezone: input.timezone,
      participantNames: interviewers.map(u => `${u.firstName} ${u.lastName}`.trim()),
      notes: input.notes,
    }

    const payload: Input = {
      candidateReference: input.candidateReference,
      type: input.type,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      interviewerEmails: input.interviewerEmails,
      notes: input.notes,
      timezone: input.timezone,
    }

    const row = await createConfirmation({
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      actionId: 'SCHEDULE_INTERVIEW',
      actionType: 'SCHEDULE_INTERVIEW',
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
      metadata: { actionId: 'SCHEDULE_INTERVIEW' },
    })

    return { ok: true, confirmationId: row.id, preview, expiresAt: row.expiresAt }
  },

  async execute(ctx, confirmationId) {
    const validated = await loadAndValidateConfirmation(ctx, confirmationId, 'SCHEDULE_INTERVIEW')
    if (!validated.ok) return { ok: false, failure: validated.failure }
    const confirmation = validated.confirmation

    if (!hasPermission(ctx.role as any, 'interview.create' as any)) {
      await markFailed(confirmationId, 'permission_denied')
      return { ok: false, failure: { code: 'PERMISSION_DENIED', message: 'You no longer have permission to schedule interviews.' } }
    }

    const inputParse = InputSchema.safeParse(confirmation.payload)
    if (!inputParse.success) {
      await markFailed(confirmationId, 'payload_invalid')
      return { ok: false, failure: { code: 'INPUT_INVALID', message: 'Confirmation payload is invalid.' } }
    }
    const input = inputParse.data

    // Re-resolve everything at confirm time
    const cand = await resolveCandidate(ctx, input.candidateReference)
    if ('code' in cand) {
      await markFailed(confirmationId, 'candidate_invalid')
      return { ok: false, failure: cand }
    }
    const fullCandidate = await db.candidate.findFirst({
      where: { id: cand.id, organizationId: ctx.organizationId },
    })
    if (!fullCandidate) {
      await markFailed(confirmationId, 'candidate_missing')
      return { ok: false, failure: { code: 'RESOURCE_NOT_FOUND', message: 'Candidate no longer exists.' } }
    }
    if (fullCandidate.status !== 'ACTIVE') {
      await markFailed(confirmationId, 'candidate_inactive')
      return { ok: false, failure: { code: 'BUSINESS_STATE_INVALID', message: `Candidate is now ${fullCandidate.status}.` } }
    }

    const hr = await db.hiringRequest.findFirst({
      where: { id: cand.hiringRequestId, organizationId: ctx.organizationId },
    })
    if (!hr || hr.status === 'CLOSED' || hr.status === 'CANCELLED') {
      await markFailed(confirmationId, 'hr_invalid')
      return { ok: false, failure: { code: 'BUSINESS_STATE_INVALID', message: 'Hiring request is no longer accepting new interviews.' } }
    }

    const interviewers = await resolveInterviewers(ctx, input.interviewerEmails)
    if ('code' in interviewers) {
      await markFailed(confirmationId, 'interviewers_invalid')
      return { ok: false, failure: interviewers }
    }

    const scheduledAt = new Date(input.scheduledAt)
    if (scheduledAt.getTime() <= Date.now()) {
      await markFailed(confirmationId, 'time_in_past')
      return { ok: false, failure: { code: 'INPUT_INVALID', message: 'The scheduled time is now in the past. Please prepare a new action.' } }
    }

    // Use a transaction so the interview + participants + activity succeed or fail together.
    const interviewId = await db.$transaction(async (tx) => {
      const interview = await tx.interview.create({
        data: {
          organizationId: ctx.organizationId,
          hiringRequestId: hr.id,
          candidateId: cand.id,
          scheduledById: ctx.userId,
          type: input.type as never,
          title: `${input.type} — ${fullCandidate.firstName} ${fullCandidate.lastName}`,
          status: 'SCHEDULED' as never,
          scheduledAt,
          durationMinutes: input.durationMinutes,
          notes: input.notes,
          stage: 'INTERVIEW',
          round: fullCandidate.stage === 'SCREENING' ? 1 : 2,
        },
      })
      for (const u of interviewers) {
        await tx.interviewParticipant.create({
          data: { interviewId: interview.id, userId: u.id, role: 'INTERVIEWER' },
        })
      }
      await tx.activity.create({
        data: {
          organizationId: ctx.organizationId,
          type: 'INTERVIEW_SCHEDULED',
          actorId: ctx.userId,
          candidateId: cand.id,
          hiringRequestId: hr.id,
          interviewId: interview.id,
          title: `Interview scheduled — ${input.type}`,
          description: `${input.durationMinutes} min · ${scheduledAt.toISOString().slice(0, 16).replace('T', ' ')} · ${interviewers.length} participant(s)`,
        },
      })
      return interview.id
    })

    const won = await markExecuted(confirmationId, { resourceId: interviewId, resourceType: 'Interview' })
    if (!won) {
      await markFailed(confirmationId, 'concurrency_conflict')
      return { ok: false, failure: { code: 'CONCURRENCY_CONFLICT', message: 'Another confirmation raced this one.' } }
    }

    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      action: 'INTERVIEW_CREATED',
      targetType: 'interview',
      targetId: interviewId,
      outcome: 'success',
      metadata: { source: 'copilot', confirmationId, type: input.type },
    })
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      action: 'COPILOT_ACTION_EXECUTED',
      targetType: 'copilot_action',
      targetId: confirmationId,
      outcome: 'success',
      metadata: { actionId: 'SCHEDULE_INTERVIEW', resourceType: 'Interview', resourceId: interviewId },
    })

    return {
      ok: true,
      confirmationId,
      result: {
        resourceId: interviewId,
        resourceType: 'Interview',
        canonicalUrl: `/interview-center?interviewId=${interviewId}`,
        label: `Interview scheduled: ${fullCandidate.firstName} ${fullCandidate.lastName} (${input.type})`,
      },
    }
  },
}
