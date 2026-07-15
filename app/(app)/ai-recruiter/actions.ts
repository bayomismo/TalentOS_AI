'use server'

/**
 * AI Recruiter server actions.
 *
 * Two actions:
 *   - `generateJobDescriptionAction` calls the AI engine and returns the
 *     validated, typed payload. The engine is server-side; the API key
 *     never leaves the server.
 *   - `createHiringRequestAction` persists a wizard draft as a real
 *     HiringRequest + JobDescription + Activity, updates the AI task,
 *     and returns the new entities so the client can publish events.
 *
 * Errors are caught and returned as typed objects — the page renders a
 * friendly retry state without ever exposing a raw stack trace.
 */

import { revalidatePath } from 'next/cache'

import { db } from '@/lib/db'
import { getAIEngine } from '@/lib/ai/service/ai-engine'
import { AIEngineError, ProviderNotConfiguredError } from '@/lib/ai/errors/ai-engine-error'
import type {
  EmploymentType,
  EvaluationCriterion,
  HiringRequestSnapshot,
  JobDescriptionDraft,
  JobDescriptionSnapshot,
  AISnapshot,
  ActivitySnapshot,
} from '@/lib/events/types'
import { slugify } from '@/lib/utils'
import { requireAuth, requirePermission, recordAuditLog } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import { safeRevalidate } from '@/lib/utils/revalidate'
import type { JobDescriptionOutput } from '@/lib/ai/schemas/job-description.schema'

// -----------------------------------------------------------------------------
// Action result helpers
// -----------------------------------------------------------------------------

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

// -----------------------------------------------------------------------------
// 1. Generate Job Description
// -----------------------------------------------------------------------------

export interface GenerateJobDescriptionInput {
  role: string
  department: string
  employmentType: EmploymentType
  experience: string
  location: string
  companySummary: string
  extraContext?: string
}

export interface GenerateJobDescriptionSuccess {
  promptId: string
  draft: JobDescriptionDraft
  aiTaskId: string
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  model: string
}

export async function generateJobDescriptionAction(
  input: GenerateJobDescriptionInput
): Promise<ActionResult<GenerateJobDescriptionSuccess>> {
  try {
    // Sprint 9 PART 13: every AI action requires ai.generate_job_description.
    const auth = await requirePermission('ai.generate_job_description')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId
    const actorId = auth.data.userId

    const engine = getAIEngine()
    const result = await engine.generateJobDescription(input)

    // Persist the AITask so the wizard run is attributable + auditable.
    const aiTask = await db.aITask.create({
      data: {
        organizationId: orgId,
        type: 'JOB_DESCRIPTION',
        title: `Job description — ${input.role}`,
        status: 'COMPLETED',
        prompt: input.role,
        result: result.data as object,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        modelUsed: result.model,
        durationMs: result.latencyMs,
        startedAt: new Date(Date.now() - result.latencyMs),
        completedAt: new Date(),
        createdById: actorId,
      },
    })

    const evaluationCriteria = deriveEvaluationCriteria(result.data)

    const draft: JobDescriptionDraft = {
      ...result.data,
      meta: {
        role: input.role,
        department: input.department,
        employmentType: input.employmentType,
        experience: input.experience,
        location: input.location,
        companySummary: input.companySummary,
      },
      evaluationCriteria,
    }

    return {
      ok: true,
      data: {
        promptId: 'job-description.v1',
        draft,
        aiTaskId: aiTask.id,
        usage: result.usage,
        model: result.model,
      },
    }
  } catch (err) {
    return actionError(err)
  }
}

// -----------------------------------------------------------------------------
// 2. Create Hiring Request (final save)
// -----------------------------------------------------------------------------

export interface CreateHiringRequestInput {
  draft: JobDescriptionDraft
  aiTaskId: string | null
}

export interface CreateHiringRequestSuccess {
  hiringRequest: HiringRequestSnapshot
  jobDescription: JobDescriptionSnapshot
  activity: ActivitySnapshot
  aiTask: AISnapshot | null
}

export async function createHiringRequestAction(
  input: CreateHiringRequestInput
): Promise<ActionResult<CreateHiringRequestSuccess>> {
  try {
    // Sprint 9: requires hiring_request.create.
    const auth = await requirePermission('hiring_request.create')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId
    const actorId = auth.data.userId
    const { draft, aiTaskId } = input

    // Validate the referenced AITask (if any) belongs to this org — IDOR guard.
    if (aiTaskId) {
      const owned = await db.aITask.findFirst({
        where: { id: aiTaskId, organizationId: orgId },
        select: { id: true },
      })
      if (!owned) {
        return { ok: false, error: { code: 'TENANT_MISMATCH', message: 'AI task not found', retryable: false } }
      }
    }

    // Find or create the department named by the wizard.
    const departmentSlug = slugify(draft.meta.department || 'engineering') || 'engineering'
    const department = await db.department.upsert({
      where: { organizationId_slug: { organizationId: orgId, slug: departmentSlug } },
      update: {},
      create: {
        organizationId: orgId,
        name: draft.meta.department || 'Engineering',
        slug: departmentSlug,
        description: 'Auto-created from AI Recruiter wizard.',
      },
    })

    // Persist the JobDescription.
    const jobDescription = await db.jobDescription.create({
      data: {
        organizationId: orgId,
        title: draft.title,
        isTemplate: false,
        level: mapLevel(draft.meta.experience),
        jobType: mapJobType(draft.meta.employmentType),
        summary: draft.summary,
        description: draft.summary,
        responsibilities: draft.responsibilities,
        requiredSkills: draft.requiredSkills,
        niceToHave: draft.preferredSkills,
        perks: draft.benefits,
      },
    })

    const slug = await uniqueHiringRequestSlug(orgId, draft.title)
    const hiringRequest = await db.hiringRequest.create({
      data: {
        organizationId: orgId,
        departmentId: department.id,
        createdById: actorId,
        hiringManagerId: actorId,
        jobDescriptionId: jobDescription.id,
        title: draft.title,
        slug,
        status: 'OPEN',
        priority: 'MEDIUM',
        jobType: mapJobType(draft.meta.employmentType),
        workArrangement: 'HYBRID',
        level: mapLevel(draft.meta.experience),
        openings: 1,
        filled: 0,
        location: draft.meta.location || null,
        summary: draft.summary,
        publishedAt: new Date(),
      },
      include: { department: true, hiringManager: true, jobDescription: true },
    })

    const activity = await db.activity.create({
      data: {
        organizationId: orgId,
        type: 'HIRING_REQUEST_CREATED',
        actorId: actorId,
        hiringRequestId: hiringRequest.id,
        title: `New hiring request — ${hiringRequest.title}`,
        description: `Created via AI Recruiter. ${hiringRequest.openings} opening(s) in ${department.name}.`,
      },
      include: { actor: true },
    })

    if (aiTaskId) {
      try {
        await db.aITask.update({
          where: { id: aiTaskId },
          data: { hiringRequestId: hiringRequest.id },
        })
      } catch {
        // AITask may belong to a different org or have been deleted; ignore.
      }
    }

    revalidatePath('/dashboard')
    revalidatePath('/hiring-requests')
    revalidatePath('/ai-recruiter')

    return {
      ok: true,
      data: {
        hiringRequest: serializeHiringRequest(hiringRequest),
        jobDescription: serializeJobDescription(jobDescription),
        activity: serializeActivity(activity),
        aiTask: aiTaskId
          ? {
              id: aiTaskId,
              type: 'JOB_DESCRIPTION',
              title: `Job description — ${draft.title}`,
              status: 'COMPLETED',
              completedAt: new Date().toISOString(),
            }
          : null,
      },
    }
  } catch (err) {
    return actionError(err)
  }
}

// -----------------------------------------------------------------------------
// 3. Save Draft
// -----------------------------------------------------------------------------

export interface SaveDraftInput {
  draft: JobDescriptionDraft
}

export interface SaveDraftSuccess {
  jobDescription: JobDescriptionSnapshot
}

export async function saveHiringRequestDraftAction(
  input: SaveDraftInput
): Promise<ActionResult<SaveDraftSuccess>> {
  try {
    // Sprint 9: saving a draft is a hiring_request.create.
    const auth = await requirePermission('hiring_request.create')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId
    const { draft } = input
    const jobDescription = await db.jobDescription.create({
      data: {
        organizationId: orgId,
        title: `Draft — ${draft.title}`,
        isTemplate: false,
        level: mapLevel(draft.meta.experience),
        jobType: mapJobType(draft.meta.employmentType),
        summary: draft.summary,
        description: draft.summary,
        responsibilities: draft.responsibilities,
        requiredSkills: draft.requiredSkills,
        niceToHave: draft.preferredSkills,
        perks: draft.benefits,
      },
    })
    return { ok: true, data: { jobDescription: serializeJobDescription(jobDescription) } }
  } catch (err) {
    return actionError(err)
  }
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

function actionError(err: unknown): ActionResult<never> {
  if (err instanceof AIEngineError) {
    return { ok: false, error: { code: err.code, message: err.message, retryable: err.retryable } }
  }
  if (err instanceof ProviderNotConfiguredError) {
    return { ok: false, error: { code: err.code, message: err.message, retryable: err.retryable } }
  }
  const message = err instanceof Error ? err.message : 'Unexpected error'
  console.error('[ai-recruiter] action error:', err)
  return { ok: false, error: { code: 'INTERNAL', message, retryable: true } }
}

async function uniqueHiringRequestSlug(orgId: string, title: string): Promise<string> {
  const base = slugify(title) || 'hiring-request'
  let slug = base
  let attempt = 1
  while (true) {
    const existing = await db.hiringRequest.findUnique({
      where: { organizationId_slug: { organizationId: orgId, slug } },
      select: { id: true },
    })
    if (!existing) return slug
    attempt += 1
    slug = `${base}-${attempt}`
  }
}

function mapJobType(employmentType: EmploymentType): 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'TEMPORARY' {
  switch (employmentType) {
    case 'FULL_TIME':
      return 'FULL_TIME'
    case 'PART_TIME':
      return 'PART_TIME'
    case 'CONTRACT':
      return 'CONTRACT'
    case 'INTERNSHIP':
      return 'INTERNSHIP'
    case 'TEMPORARY':
      return 'TEMPORARY'
  }
}

function mapLevel(experience: string): 'ENTRY' | 'JUNIOR' | 'MID' | 'SENIOR' | 'STAFF' | 'PRINCIPAL' | 'LEAD' | 'EXECUTIVE' {
  const lower = experience.toLowerCase()
  if (lower.includes('executive') || lower.includes('vp') || lower.includes('c-level')) return 'EXECUTIVE'
  if (lower.includes('lead')) return 'LEAD'
  if (lower.includes('principal')) return 'PRINCIPAL'
  if (lower.includes('staff')) return 'STAFF'
  if (lower.includes('senior') || /\b[5-9]\+?\s*year/.test(lower)) return 'SENIOR'
  if (lower.includes('junior') || /\b[1-3]\+?\s*year/.test(lower)) return 'JUNIOR'
  if (lower.includes('entry') || lower.includes('graduate') || lower.includes('intern')) return 'ENTRY'
  return 'MID'
}

function deriveEvaluationCriteria(jd: JobDescriptionOutput): EvaluationCriterion[] {
  const totalSkills = jd.requiredSkills.length
  if (totalSkills === 0) return []

  const buckets: Record<string, string[]> = {
    'Core technical skills': [],
    'System & architecture': [],
    'Collaboration & communication': [],
    'Product & impact': [],
  }

  for (const skill of jd.requiredSkills) {
    const lower = skill.toLowerCase()
    if (
      lower.includes('system design') ||
      lower.includes('architecture') ||
      lower.includes('scalability') ||
      lower.includes('performance')
    ) {
      buckets['System & architecture']!.push(skill)
    } else if (
      lower.includes('communication') ||
      lower.includes('collaboration') ||
      lower.includes('leadership') ||
      lower.includes('mentor')
    ) {
      buckets['Collaboration & communication']!.push(skill)
    } else if (
      lower.includes('product') ||
      lower.includes('impact') ||
      lower.includes('business')
    ) {
      buckets['Product & impact']!.push(skill)
    } else {
      buckets['Core technical skills']!.push(skill)
    }
  }

  const presentBuckets = Object.entries(buckets).filter(([, skills]) => skills.length > 0)
  if (presentBuckets.length === 0) return []

  const baseWeight = Math.floor(100 / presentBuckets.length)
  let remainder = 100 - baseWeight * presentBuckets.length

  return presentBuckets.map(([category, skills], idx) => ({
    id: `crit-${idx + 1}`,
    category,
    weight: baseWeight + (remainder-- > 0 ? 1 : 0),
    indicators: skills.slice(0, 3),
  }))
}

function serializeHiringRequest(hr: {
  id: string
  title: string
  status: string
  priority: string
  openings: number
  filled: number
  location: string | null
  jobType: string
  workArrangement: string
  level: string
  salaryMin: number | null
  salaryMax: number | null
  createdAt: Date
  department: { name: string }
  hiringManager: { firstName: string; lastName: string } | null
  jobDescription: { summary: string | null } | null
}): HiringRequestSnapshot {
  return {
    id: hr.id,
    title: hr.title,
    status: hr.status as HiringRequestSnapshot['status'],
    priority: hr.priority as HiringRequestSnapshot['priority'],
    department: hr.department.name,
    openings: hr.openings,
    filled: hr.filled,
    location: hr.location,
    jobType: hr.jobType as HiringRequestSnapshot['jobType'],
    workArrangement: hr.workArrangement as HiringRequestSnapshot['workArrangement'],
    level: hr.level as HiringRequestSnapshot['level'],
    salaryMin: hr.salaryMin,
    salaryMax: hr.salaryMax,
    createdAt: hr.createdAt.toISOString(),
    hiringManagerName: hr.hiringManager ? `${hr.hiringManager.firstName} ${hr.hiringManager.lastName}` : null,
    jobDescriptionSummary: hr.jobDescription?.summary ?? null,
  }
}

function serializeJobDescription(jd: {
  id: string
  title: string
  summary: string | null
  responsibilities: string[]
  requiredSkills: string[]
  niceToHave: string[]
  perks: string[]
}): JobDescriptionSnapshot {
  return {
    id: jd.id,
    title: jd.title,
    summary: jd.summary,
    responsibilities: jd.responsibilities,
    requiredSkills: jd.requiredSkills,
    preferredSkills: jd.niceToHave,
    qualifications: [],
    benefits: jd.perks,
    screeningQuestions: [],
    interviewQuestions: [],
  }
}

function serializeActivity(a: {
  id: string
  type: string
  title: string
  description: string | null
  actor: { firstName: string; lastName: string } | null
  occurredAt: Date
}): ActivitySnapshot {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    description: a.description,
    actorName: a.actor ? `${a.actor.firstName} ${a.actor.lastName}` : null,
    candidateName: null,
    occurredAt: a.occurredAt.toISOString(),
  }
}
