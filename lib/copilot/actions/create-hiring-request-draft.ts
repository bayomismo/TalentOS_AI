/**
 * Sprint 11.1 — Action: CREATE_HIRING_REQUEST_DRAFT
 *
 * PART 6: create a hiring request in DRAFT status. The AI gathers the
 * required fields (title, department, level, employment type, work
 * arrangement, openings, optional location / hiring manager / summary)
 * and produces a candidate argument. The server validates, previews,
 * persists a confirmation row, and on confirm calls the existing
 * domain logic to create a DRAFT hiring request.
 *
 * Hard rules:
 *   - The created HiringRequest MUST remain in DRAFT status.
 *   - The Copilot cannot publish/open it automatically.
 *   - Existing permissions (`hiring_request.create`) are required.
 *   - The hiring manager, if supplied, must be a member of the same org.
 */

import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'
import { hasPermission } from '@/lib/auth/permissions'
import { slugify } from '@/lib/utils'
import type { CopilotAuthContext } from '../types'
import type {
  CopilotActionDefinition,
  ActionContextSnapshot,
  ActionExecutionResult,
  ActionFailure,
  AnyActionPreview,
} from './types'
import {
  createConfirmation,
  loadAndValidateConfirmation,
  markExecuted,
  markFailed,
} from '../security/confirmations'

// ---------------------------------------------------------------------------
// Input schema — what the AI is allowed to produce
// ---------------------------------------------------------------------------

const InputSchema = z.object({
  title: z.string().min(2).max(160),
  departmentName: z.string().min(1).max(80).optional(),
  departmentId: z.string().uuid().optional(),
  level: z.enum(['ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'STAFF', 'PRINCIPAL']).default('MID'),
  jobType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY']).default('FULL_TIME'),
  workArrangement: z.enum(['ONSITE', 'REMOTE', 'HYBRID']).default('ONSITE'),
  openings: z.number().int().min(1).max(50).default(1),
  location: z.string().min(1).max(160).optional(),
  hiringManagerEmail: z.string().email().optional(),
  hiringManagerId: z.string().uuid().optional(),
  summary: z.string().min(10).max(2000).optional(),
})

type Input = z.infer<typeof InputSchema>

// ---------------------------------------------------------------------------
// Preview schema — what the user sees in the confirmation card
// ---------------------------------------------------------------------------

const PreviewSchema = z.object({
  title: z.string(),
  department: z.string(),
  level: z.string(),
  jobType: z.string(),
  workArrangement: z.string(),
  openings: z.number(),
  location: z.string().optional(),
  hiringManager: z.string().optional(),
  summary: z.string().optional(),
  willCreateAs: z.literal('DRAFT'),
})

type Preview = z.infer<typeof PreviewSchema>

// ---------------------------------------------------------------------------
// Action implementation
// ---------------------------------------------------------------------------

async function generateUniqueSlug(orgId: string, title: string): Promise<string> {
  const base = slugify(title) || 'hiring-request'
  let candidate = base
  let attempt = 1
  while (true) {
    const existing = await db.hiringRequest.findUnique({
      where: { organizationId_slug: { organizationId: orgId, slug: candidate } },
      select: { id: true },
    })
    if (!existing) return candidate
    attempt += 1
    candidate = `${base}-${attempt}`
    if (attempt > 100) return `${base}-${Date.now()}`
  }
}

async function resolveDepartment(ctx: CopilotAuthContext, input: Input): Promise<{ id: string; name: string } | ActionFailure> {
  if (input.departmentId) {
    const dept = await db.department.findFirst({
      where: { id: input.departmentId, organizationId: ctx.organizationId },
    })
    if (!dept) return { code: 'RESOURCE_NOT_FOUND', message: 'Department not found in this organization.' }
    return { id: dept.id, name: dept.name }
  }
  if (input.departmentName) {
    const dept = await db.department.findFirst({
      where: { organizationId: ctx.organizationId, name: { equals: input.departmentName, mode: 'insensitive' } },
    })
    if (dept) return { id: dept.id, name: dept.name }
    return { code: 'RESOURCE_NOT_FOUND', message: `Department "${input.departmentName}" not found. Please provide an existing department or omit this field.` }
  }
  // Fall back to the first department in the org
  const first = await db.department.findFirst({ where: { organizationId: ctx.organizationId } })
  if (first) return { id: first.id, name: first.name }
  return { code: 'BUSINESS_STATE_INVALID', message: 'No department exists in this organization yet. Create one first.' }
}

async function resolveHiringManager(
  ctx: CopilotAuthContext,
  input: Input,
): Promise<{ id: string; name: string } | null> {
  if (input.hiringManagerId) {
    const u = await db.user.findFirst({
      where: { id: input.hiringManagerId, organizationId: ctx.organizationId, status: 'ACTIVE' },
    })
    if (!u) return null
    return { id: u.id, name: `${u.firstName} ${u.lastName}`.trim() }
  }
  if (input.hiringManagerEmail) {
    const u = await db.user.findFirst({
      where: { email: input.hiringManagerEmail.toLowerCase(), organizationId: ctx.organizationId, status: 'ACTIVE' },
    })
    if (!u) return null
    return { id: u.id, name: `${u.firstName} ${u.lastName}`.trim() }
  }
  return null
}

export const createHiringRequestDraftAction: CopilotActionDefinition<Input, Preview> = {
  id: 'CREATE_HIRING_REQUEST_DRAFT',
  description: 'Create a new hiring request in DRAFT status. The Copilot cannot publish or open the request automatically — a human must take it from there.',
  inputSchema: InputSchema,
  previewSchema: PreviewSchema,
  resultSchema: z.object({
    resourceId: z.string(),
    resourceType: z.literal('HiringRequest'),
    canonicalUrl: z.string(),
    label: z.string(),
  }),
  requiredPermissions: ['hiring_request.create'],

  async prepare(ctx, input) {
    // PART 4: PHASE 1 — no business mutation
    if (!hasPermission(ctx.role as any, 'hiring_request.create' as any)) {
      return { ok: false, failure: { code: 'PERMISSION_DENIED', message: 'You do not have permission to create hiring requests.' } }
    }

    // Resolve canonical references
    const dept = await resolveDepartment(ctx, input)
    if ('code' in dept) return { ok: false, failure: dept }
    const hm = await resolveHiringManager(ctx, input)

    const preview: Preview = {
      title: input.title,
      department: dept.name,
      level: input.level,
      jobType: input.jobType.replace('_', '-').toLowerCase(),
      workArrangement: input.workArrangement.toLowerCase(),
      openings: input.openings,
      location: input.location,
      hiringManager: hm?.name,
      summary: input.summary,
      willCreateAs: 'DRAFT',
    }

    const payload: Input = {
      title: input.title,
      departmentId: dept.id,
      level: input.level,
      jobType: input.jobType,
      workArrangement: input.workArrangement,
      openings: input.openings,
      location: input.location,
      hiringManagerId: hm?.id,
      summary: input.summary,
    }

    const row = await createConfirmation({
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      actionId: 'CREATE_HIRING_REQUEST_DRAFT',
      actionType: 'CREATE_HIRING_REQUEST_DRAFT',
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
      metadata: { actionId: 'CREATE_HIRING_REQUEST_DRAFT' },
    })

    return { ok: true, confirmationId: row.id, preview, expiresAt: row.expiresAt }
  },

  async execute(ctx, confirmationId) {
    // PART 4: PHASE 2 — re-check everything
    const validated = await loadAndValidateConfirmation(ctx, confirmationId, 'CREATE_HIRING_REQUEST_DRAFT')
    if (!validated.ok) return { ok: false, failure: validated.failure }
    const confirmation = validated.confirmation

    // Re-check permission (PART 11)
    if (!hasPermission(ctx.role as any, 'hiring_request.create' as any)) {
      await markFailed(confirmationId, 'permission_denied')
      await recordAuditLog({
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: 'COPILOT_ACTION_FAILED',
        targetType: 'copilot_action',
        targetId: confirmationId,
        outcome: 'denied',
        reason: 'permission_denied',
        metadata: { actionId: 'CREATE_HIRING_REQUEST_DRAFT' },
      })
      return { ok: false, failure: { code: 'PERMISSION_DENIED', message: 'You no longer have permission to create hiring requests.' } }
    }

    // Re-parse payload from the confirmation row (PART 4: server-controlled)
    const inputParse = InputSchema.safeParse(confirmation.payload)
    if (!inputParse.success) {
      await markFailed(confirmationId, 'payload_invalid')
      return { ok: false, failure: { code: 'INPUT_INVALID', message: 'Confirmation payload is invalid.' } }
    }
    const input = inputParse.data

    // Re-resolve canonical references at confirm time (PART 11)
    const dept = await resolveDepartment(ctx, input)
    if ('code' in dept) {
      await markFailed(confirmationId, 'department_invalid')
      return { ok: false, failure: dept }
    }
    const hm = await resolveHiringManager(ctx, input)

    // Check if a hiring request with the same title already exists (race condition)
    const slug = await generateUniqueSlug(ctx.organizationId, input.title)

    // Create the hiring request. MUST stay in DRAFT.
    const hr = await db.hiringRequest.create({
      data: {
        organizationId: ctx.organizationId,
        departmentId: dept.id,
        createdById: ctx.userId,
        hiringManagerId: hm?.id ?? ctx.userId,
        title: input.title,
        slug,
        status: 'DRAFT' as never,
        priority: 'MEDIUM',
        jobType: input.jobType as never,
        workArrangement: input.workArrangement as never,
        level: input.level as never,
        openings: input.openings,
        filled: 0,
        location: input.location,
        summary: input.summary,
      },
      include: { department: true, hiringManager: true },
    })

    // PART 12: atomically mark EXECUTED. If we lose the race, abort.
    const won = await markExecuted(confirmationId, { resourceId: hr.id, resourceType: 'HiringRequest' })
    if (!won) {
      // Concurrent execution — best effort: leave the HR but mark the confirmation
      // as FAILED. The duplicate HR will be cleaned up by the next migration script
      // or by an admin.
      await markFailed(confirmationId, 'concurrency_conflict')
      return { ok: false, failure: { code: 'CONCURRENCY_CONFLICT', message: 'Another confirmation raced this one.' } }
    }

    // Audit
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      action: 'HIRING_REQUEST_CREATED',
      targetType: 'hiring_request',
      targetId: hr.id,
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
      metadata: {
        actionId: 'CREATE_HIRING_REQUEST_DRAFT',
        resourceType: 'HiringRequest',
        resourceId: hr.id,
      },
    })

    return {
      ok: true,
      confirmationId,
      result: {
        resourceId: hr.id,
        resourceType: 'HiringRequest',
        canonicalUrl: `/hiring-requests/${hr.id}/candidates`,
        label: `Hiring Request draft created: ${hr.title}`,
      },
    }
  },
}
