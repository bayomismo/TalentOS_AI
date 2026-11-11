/**
 * Data rights — access and erasure (audit P2-13).
 *
 * The product had no way to answer a data-subject request:
 *   - no export of what is held about one person, and
 *   - no way to erase one person (the only removal flow wiped the whole
 *     organization, which also tore down every public posting).
 *
 * Both flows below are tenant-scoped through the CANDIDATE'S OWN foreign
 * key (`candidate.organizationId`) and are ADMIN-only.
 *
 * They reflect the REAL schema:
 *   - `Application` (per-application history + consent) is deleted,
 *   - `CVFile` rows are deleted AND their bytes are removed from the
 *     storage backend — deleting the row alone would leave the original
 *     document on disk,
 *   - `EmailOutbox` has NO organizationId (it is a global mail log), so
 *     candidate-addressed messages are matched by the candidate's email
 *     address and a candidate-facing message kind,
 *   - `AuditLog` rows are RETAINED: they are the security trail, not
 *     candidate data, and the schema deliberately keeps them alive when
 *     the organization is deleted.
 */

import 'server-only'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'
import { hasPermission } from '@/lib/auth/permissions'
import { getFileStorage } from '@/lib/storage'
import { randomUUID } from 'crypto'

export interface RightsContext {
  organizationId: string
  userId: string
  role: string
}

export interface ServiceResult<T> {
  ok: boolean
  data?: T
  error?: { code: string; message: string }
}

/** Message kinds that are addressed TO a candidate (not to our admins). */
const CANDIDATE_EMAIL_KINDS = ['interview_reminder', 'offer_letter']

/** The phrase an admin must type to erase a candidate. */
export const ERASE_CONFIRMATION = 'ERASE CANDIDATE'

function denied(): ServiceResult<never> {
  return {
    ok: false,
    error: { code: 'PERMISSION_DENIED', message: 'Only ADMIN can manage candidate data rights.' },
  }
}

// -----------------------------------------------------------------------------
// Candidate picker
// -----------------------------------------------------------------------------

export interface RightsCandidateRef {
  id: string
  name: string
  email: string
  stage: string
}

/** The candidates an admin can run a data-rights request against. */
export async function listRightsCandidates(
  ctx: RightsContext
): Promise<ServiceResult<RightsCandidateRef[]>> {
  if (!hasPermission(ctx.role as never, 'organization.manage' as never)) return denied()

  const rows = await db.candidate.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, firstName: true, lastName: true, email: true, stage: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return {
    ok: true,
    data: rows.map(r => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      email: r.email,
      stage: r.stage,
    })),
  }
}

// -----------------------------------------------------------------------------
// Preview — what we hold and what an erasure would remove
// -----------------------------------------------------------------------------

export interface CandidateRightsPreview {
  candidate: {
    id: string
    name: string
    email: string
    stage: string
    appliedAt: string | null
    hiredAt: string | null
  }
  willDelete: {
    applications: number
    skills: number
    experiences: number
    educations: number
    certifications: number
    cvFiles: number
    cvFilesWithStoredBytes: number
    interviews: number
    interviewEvaluations: number
    decisions: number
    offers: number
    activities: number
    aiTasks: number
    copilotConfirmations: number
    emailMessages: number
  }
  retained: {
    auditLogs: number
    hiringRequest: string
  }
}

export async function previewCandidateRights(
  ctx: RightsContext,
  candidateId: string
): Promise<ServiceResult<CandidateRightsPreview>> {
  if (!hasPermission(ctx.role as never, 'organization.manage' as never)) return denied()

  const candidate = await db.candidate.findFirst({
    where: { id: candidateId, organizationId: ctx.organizationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      stage: true,
      appliedAt: true,
      hiredAt: true,
      hiringRequest: { select: { title: true } },
    },
  })
  if (!candidate) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Candidate not found.' } }
  }

  const [
    applications,
    skills,
    experiences,
    educations,
    certifications,
    cvFiles,
    interviews,
    interviewEvaluations,
    decisions,
    offers,
    activities,
    aiTasks,
    copilotConfirmations,
    emailMessages,
    auditLogs,
  ] = await Promise.all([
    db.application.count({ where: { candidateId, organizationId: ctx.organizationId } }),
    db.candidateSkill.count({ where: { candidateId, candidate: { organizationId: ctx.organizationId } } }),
    db.candidateExperience.count({ where: { candidateId, candidate: { organizationId: ctx.organizationId } } }),
    db.candidateEducation.count({ where: { candidateId, candidate: { organizationId: ctx.organizationId } } }),
    db.candidateCertification.count({ where: { candidateId, candidate: { organizationId: ctx.organizationId } } }),
    db.cVFile.findMany({
      where: { candidateId, candidate: { organizationId: ctx.organizationId } },
      select: { id: true, storagePath: true },
    }),
    db.interview.count({ where: { candidateId, organizationId: ctx.organizationId } }),
    db.interviewEvaluation.count({ where: { interview: { candidateId, organizationId: ctx.organizationId } } }),
    db.candidateDecision.count({ where: { candidateId, organizationId: ctx.organizationId } }),
    db.offer.count({ where: { candidateId, organizationId: ctx.organizationId } }),
    db.activity.count({ where: { candidateId, organizationId: ctx.organizationId } }),
    db.aITask.count({
      where: { organizationId: ctx.organizationId, metadata: { path: ['candidateId'], equals: candidateId } },
    }),
    db.copilotActionConfirmation.count({
      where: { organizationId: ctx.organizationId, payload: { path: ['candidateId'], equals: candidateId } },
    }),
    db.emailOutbox.count({
      where: { to: candidate.email, kind: { in: CANDIDATE_EMAIL_KINDS } },
    }),
    db.auditLog.count({ where: { organizationId: ctx.organizationId, targetId: candidateId } }),
  ])

  const storage = getFileStorage()
  let cvFilesWithStoredBytes = 0
  for (const file of cvFiles) {
    if (!file.storagePath) continue
    try {
      const url = await storage.getDownloadUrl(file.storagePath)
      if (url && !url.startsWith('memory://')) cvFilesWithStoredBytes++
    } catch {
      /* unreadable key — treat as "no bytes retained" */
    }
  }

  return {
    ok: true,
    data: {
      candidate: {
        id: candidate.id,
        name: `${candidate.firstName} ${candidate.lastName}`,
        email: candidate.email,
        stage: candidate.stage,
        appliedAt: candidate.appliedAt ? candidate.appliedAt.toISOString() : null,
        hiredAt: candidate.hiredAt ? candidate.hiredAt.toISOString() : null,
      },
      willDelete: {
        applications,
        skills,
        experiences,
        educations,
        certifications,
        cvFiles: cvFiles.length,
        cvFilesWithStoredBytes,
        interviews,
        interviewEvaluations,
        decisions,
        offers,
        activities,
        aiTasks,
        copilotConfirmations,
        emailMessages,
      },
      retained: {
        auditLogs,
        hiringRequest: candidate.hiringRequest.title,
      },
    },
  }
}

// -----------------------------------------------------------------------------
// Export — right of access
// -----------------------------------------------------------------------------

export interface CandidateDataExport {
  exportedAt: string
  organization: { id: string; name: string }
  candidate: Record<string, unknown>
  skills: Array<Record<string, unknown>>
  experiences: Array<Record<string, unknown>>
  educations: Array<Record<string, unknown>>
  certifications: Array<Record<string, unknown>>
  cvFiles: Array<Record<string, unknown>>
  applications: Array<Record<string, unknown>>
  interviews: Array<Record<string, unknown>>
  decisions: Array<Record<string, unknown>>
  offers: Array<Record<string, unknown>>
  activities: Array<Record<string, unknown>>
  emailMessages: Array<Record<string, unknown>>
}

export async function exportCandidateData(
  ctx: RightsContext,
  candidateId: string
): Promise<ServiceResult<CandidateDataExport>> {
  if (!hasPermission(ctx.role as never, 'organization.manage' as never)) return denied()

  const candidate = await db.candidate.findFirst({
    where: { id: candidateId, organizationId: ctx.organizationId },
    include: {
      skills: true,
      experiences: true,
      educations: true,
      certifications: true,
      cvFiles: true,
      applications: { include: { hiringRequest: { select: { title: true } } } },
      interviews: {
        include: {
          participants: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
      },
      candidateDecisions: {
        include: { decidedBy: { select: { firstName: true, lastName: true } } },
      },
      offers: true,
      activities: true,
      hiringRequest: { select: { id: true, title: true } },
    },
  })
  if (!candidate) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Candidate not found.' } }
  }

  const organization = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { id: true, name: true },
  })

  const emailMessages = await db.emailOutbox.findMany({
    where: { to: candidate.email, kind: { in: CANDIDATE_EMAIL_KINDS } },
    select: {
      kind: true,
      subject: true,
      text: true,
      status: true,
      provider: true,
      deliveryStatus: true,
      sentAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const {
    skills,
    experiences,
    educations,
    certifications,
    cvFiles,
    applications,
    interviews,
    candidateDecisions,
    offers,
    activities,
    ...profile
  } = candidate

  return {
    ok: true,
    data: {
      exportedAt: new Date().toISOString(),
      organization: organization ?? { id: ctx.organizationId, name: 'Unknown' },
      candidate: {
        ...profile,
        appliedAt: profile.appliedAt.toISOString(),
        hiredAt: profile.hiredAt ? profile.hiredAt.toISOString() : null,
        rejectedAt: profile.rejectedAt ? profile.rejectedAt.toISOString() : null,
        withdrawnAt: profile.withdrawnAt ? profile.withdrawnAt.toISOString() : null,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      },
      skills,
      experiences: experiences.map(e => ({
        ...e,
        startDate: e.startDate.toISOString(),
        endDate: e.endDate ? e.endDate.toISOString() : null,
      })),
      educations: educations.map(e => ({
        ...e,
        startDate: e.startDate ? e.startDate.toISOString() : null,
        endDate: e.endDate ? e.endDate.toISOString() : null,
      })),
      certifications: certifications.map(c => ({
        ...c,
        issueDate: c.issueDate ? c.issueDate.toISOString() : null,
        expiryDate: c.expiryDate ? c.expiryDate.toISOString() : null,
      })),
      cvFiles: cvFiles.map(f => ({
        id: f.id,
        fileName: f.fileName,
        fileType: f.fileType,
        fileSize: f.fileSize,
        mimeType: f.mimeType,
        uploadedAt: f.uploadedAt.toISOString(),
        storageUrl: f.storageUrl,
        parsedText: f.parsedText,
      })),
      applications: applications.map(a => ({
        id: a.id,
        hiringRequestTitle: a.hiringRequest.title,
        stage: a.stage,
        source: a.source,
        appliedAt: a.appliedAt.toISOString(),
        consentAt: a.consentAt ? a.consentAt.toISOString() : null,
        consentText: a.consentText,
        matchScore: a.matchScore,
      })),
      interviews: interviews.map(i => ({
        id: i.id,
        type: i.type,
        status: i.status,
        scheduledAt: i.scheduledAt ? i.scheduledAt.toISOString() : null,
        durationMinutes: i.durationMinutes,
        participants: i.participants.map(p => `${p.user.firstName} ${p.user.lastName}`),
      })),
      decisions: candidateDecisions.map(d => ({
        id: d.id,
        decision: d.decision,
        notes: d.notes,
        reason: d.reason,
        decidedBy: `${d.decidedBy.firstName} ${d.decidedBy.lastName}`,
        decidedAt: d.decidedAt.toISOString(),
        supersedesId: d.supersedesId,
      })),
      offers: offers.map(o => ({
        id: o.id,
        title: o.title,
        status: o.status,
        salaryAmount: o.salaryAmount,
        salaryCurrency: o.salaryCurrency,
        salaryPeriod: o.salaryPeriod,
        startDate: o.startDate ? o.startDate.toISOString() : null,
        expiresAt: o.expiresAt ? o.expiresAt.toISOString() : null,
        issuedAt: o.issuedAt ? o.issuedAt.toISOString() : null,
        respondedAt: o.respondedAt ? o.respondedAt.toISOString() : null,
        notes: o.notes,
      })),
      activities: activities.map(a => ({
        id: a.id,
        type: a.type,
        title: a.title,
        description: a.description,
        occurredAt: a.occurredAt.toISOString(),
      })),
      emailMessages: emailMessages.map(m => ({
        kind: m.kind,
        subject: m.subject,
        text: m.text,
        status: m.status,
        provider: m.provider,
        deliveryStatus: m.deliveryStatus,
        sentAt: m.sentAt ? m.sentAt.toISOString() : null,
        createdAt: m.createdAt.toISOString(),
      })),
    },
  }
}

// -----------------------------------------------------------------------------
// Erasure — right to be forgotten
// -----------------------------------------------------------------------------

export interface CandidateErasureResult {
  candidateId: string
  candidateName: string
  removed: Record<string, number>
  retained: { auditLogs: number }
}

export async function eraseCandidateData(
  ctx: RightsContext,
  candidateId: string,
  confirmation: string
): Promise<ServiceResult<CandidateErasureResult>> {
  if (!hasPermission(ctx.role as never, 'organization.manage' as never)) return denied()
  if (confirmation.trim() !== ERASE_CONFIRMATION) {
    return {
      ok: false,
      error: {
        code: 'CONFIRMATION_REQUIRED',
        message: `You must type "${ERASE_CONFIRMATION}" to confirm.`,
      },
    }
  }

  const candidate = await db.candidate.findFirst({
    where: { id: candidateId, organizationId: ctx.organizationId },
    select: { id: true, firstName: true, lastName: true, email: true },
  })
  if (!candidate) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Candidate not found.' } }
  }

  // The bytes live outside the database — collect them BEFORE the rows go.
  const cvFiles = await db.cVFile.findMany({
    where: { candidateId, candidate: { organizationId: ctx.organizationId } },
    select: { id: true, storagePath: true },
  })

  const removed = await db.$transaction(async (tx) => {
    const counts: Record<string, number> = {}

    // Mail log — no FK to the candidate, matched by address + kind.
    counts.emailMessages = (
      await tx.emailOutbox.deleteMany({
        where: { to: candidate.email, kind: { in: CANDIDATE_EMAIL_KINDS } },
      })
    ).count

    // AI work that referenced this candidate (metadata / payload).
    counts.aiTasks = (
      await tx.aITask.deleteMany({
        where: {
          organizationId: ctx.organizationId,
          metadata: { path: ['candidateId'], equals: candidate.id },
        },
      })
    ).count
    counts.copilotConfirmations = (
      await tx.copilotActionConfirmation.deleteMany({
        where: {
          organizationId: ctx.organizationId,
          payload: { path: ['candidateId'], equals: candidate.id },
        },
      })
    ).count

    // The candidate row itself. Every child row in the schema cascades
    // from it: applications, skills, experiences, educations,
    // certifications, cv files, interviews (+ questions, participants,
    // evaluations), decisions, offers and activities.
    counts.candidate = (await tx.candidate.deleteMany({
      where: { id: candidate.id, organizationId: ctx.organizationId },
    })).count

    return counts
  }, { timeout: 30000, maxWait: 10000 })

  // Remove the stored originals — deleting the row alone would leave the
  // document on disk.
  const storage = getFileStorage()
  let removedFiles = 0
  for (const file of cvFiles) {
    if (!file.storagePath) continue
    try {
      await storage.delete(file.storagePath)
      removedFiles++
    } catch (err) {
      console.error('[data-rights] failed to delete stored file', file.id, err)
    }
  }
  removed.storedFiles = removedFiles
  removed.cvFiles = cvFiles.length

  const auditLogs = await db.auditLog.count({
    where: { organizationId: ctx.organizationId, targetId: candidate.id },
  })

  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'CANDIDATE_ERASED' as never,
    targetType: 'candidate',
    targetId: candidate.id,
    outcome: 'success',
    metadata: {
      erasureId: randomUUID(),
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      removed,
      retained: { auditLogs },
    } as never,
  })

  return {
    ok: true,
    data: {
      candidateId: candidate.id,
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      removed,
      retained: { auditLogs },
    },
  }
}
