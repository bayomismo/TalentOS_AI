/**
 * Sprint 12 — Data Management service.
 *
 * PART 2: ADMIN-only safe cleanup of demo/test/E2E records from the
 * real production organization.
 *
 * Hard rules:
 *   - ADMIN permission required
 *   - Never trust authorization from the UI
 *   - Preserve the Organization
 *   - Preserve the current ADMIN user
 *   - Preserve authentication/security configuration
 *   - Preserve required PromptTemplates
 *   - Preserve any record that cannot be safely classified
 *   - Respect FK dependencies
 *   - Run inside a transaction
 *   - Write a single comprehensive AuditLog entry
 *   - No secrets logged
 */

import 'server-only'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/auth/audit'
import { hasPermission } from '@/lib/auth/permissions'
import { randomUUID } from 'crypto'

export interface ServiceResult<T> {
  ok: boolean
  data?: T
  error?: { code: string; message: string }
}

// -----------------------------------------------------------------------------
// Classification patterns
// -----------------------------------------------------------------------------

/**
 * Returns true if the record is highly likely to be a test/E2E record.
 * These are deterministic markers introduced by our own test scripts
 * and Sprint 10-11.1 E2E flows. If a record does not match any of
 * these, it is preserved as potentially real.
 */
function isTestUser(u: { email: string; firstName: string; lastName: string }): boolean {
  const hay = `${u.email} ${u.firstName} ${u.lastName}`.toLowerCase()
  if (/sprint\d+-test/.test(hay)) return true
  if (/sprint\d+[-_]?(test|viewer|interviewer|admin)/.test(hay)) return true
  if (/change-password-test/.test(hay)) return true
  if (/test-viewer/.test(hay)) return true
  if (/acme[-_]?company/.test(u.email)) {
    // acmecompany.com was the test tenant domain. Real users will not be there.
    return true
  }
  return false
}

function isTestCandidate(c: { email: string; firstName: string; lastName: string }): boolean {
  const hay = `${c.email} ${c.firstName} ${c.lastName}`.toLowerCase()
  if (/^sprint\d+-/.test(c.email.toLowerCase())) return true
  if (/sprint\d+[-_]?cand[-_]?/.test(c.email.toLowerCase())) return true
  if (/^selected[-_]?candidate/.test(hay)) return true
  if (/@example\.com$/.test(c.email.toLowerCase()) && /sprint/.test(hay)) return true
  if (/@test\.local$/.test(c.email.toLowerCase())) return true
  if (/@acmecompany\.com$/.test(c.email.toLowerCase())) return true
  return false
}

function isTestHiringRequest(h: { title: string }): boolean {
  const t = h.title.toLowerCase()
  if (/^sprint \d+ test role/.test(t)) return true
  if (/\bsprint\d+ hr\b/.test(t)) return true
  if (/^test role$/.test(t)) return true
  if (/\bsprint111 test/.test(t)) return true
  return false
}

// -----------------------------------------------------------------------------
// PART 2 — Preview / classify
// -----------------------------------------------------------------------------

export interface DataManagementPreview {
  organization: { id: string; name: string; slug: string }
  protected: {
    admins: number
    promptTemplates: number
    authSessions: number
    invitations: number
  }
  removable: {
    testUsers: number
    testCandidates: number
    testHiringRequests: number
    associated: {
      interviews: number
      decisions: number
      offers: number
      activities: number
      aiTasks: number
      copilotConfirmations: number
      auditLogs: number
    }
  }
  /// Records that look like they might be real and will NOT be touched.
  potentiallyReal: {
    users: number
    candidates: number
    hiringRequests: number
  }
}

export async function previewDataManagement(
  ctx: { organizationId: string; userId: string; role: string },
): Promise<ServiceResult<DataManagementPreview>> {
  if (!hasPermission(ctx.role as any, 'organization.manage' as any)) {
    return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Only ADMIN can manage data.' } }
  }
  const org = await db.organization.findUnique({ where: { id: ctx.organizationId } })
  if (!org) return { ok: false, error: { code: 'NOT_FOUND', message: 'Organization not found.' } }

  // Protected
  const admins = await db.user.count({
    where: { organizationId: ctx.organizationId, role: 'ADMIN', status: 'ACTIVE' },
  })
  const promptTemplates = await db.promptTemplate.count({ where: { organizationId: ctx.organizationId } })
  const authSessions = await db.authSession.count({
    where: { user: { organizationId: ctx.organizationId } },
  })
  const invitations = await db.invitation.count({ where: { organizationId: ctx.organizationId } })

  // Removable
  const allUsers = await db.user.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true },
  })
  const testUsersList = allUsers.filter(isTestUser)
  const testUserIds = new Set(testUsersList.map(u => u.id))
  // Preserve the calling ADMIN even if they accidentally match a pattern
  for (const id of testUserIds) {
    if (id === ctx.userId) testUserIds.delete(id)
  }
  const testUsers = testUserIds.size

  const allCands = await db.candidate.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, email: true, firstName: true, lastName: true },
  })
  const testCands = allCands.filter(isTestCandidate)
  const testCandIds = new Set(testCands.map(c => c.id))

  const allHrs = await db.hiringRequest.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, title: true },
  })
  const testHrs = allHrs.filter(isTestHiringRequest)
  const testHrIds = new Set(testHrs.map(h => h.id))

  // ASSOCIATED RECORDS — records owned by test HRs / candidates
  const interviews = await db.interview.count({
    where: {
      organizationId: ctx.organizationId,
      OR: [
        { hiringRequestId: { in: Array.from(testHrIds) } },
        { candidateId: { in: Array.from(testCandIds) } },
      ],
    },
  })
  const decisions = await db.candidateDecision.count({
    where: {
      organizationId: ctx.organizationId,
      OR: [
        { hiringRequestId: { in: Array.from(testHrIds) } },
        { candidateId: { in: Array.from(testCandIds) } },
      ],
    },
  })
  const offers = await db.offer.count({
    where: {
      organizationId: ctx.organizationId,
      OR: [
        { hiringRequestId: { in: Array.from(testHrIds) } },
        { candidateId: { in: Array.from(testCandIds) } },
      ],
    },
  })
  const activities = await db.activity.count({
    where: {
      organizationId: ctx.organizationId,
      OR: [
        { hiringRequestId: { in: Array.from(testHrIds) } },
        { candidateId: { in: Array.from(testCandIds) } },
      ],
    },
  })
  const allAiTasks = await db.aITask.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, metadata: true },
  })
  const aiTasks = allAiTasks.filter(t => {
    const meta = (t.metadata as any) ?? {}
    const candId = meta.candidateId
    const hrId = meta.hiringRequestId
    if (candId && testCandIds.has(candId)) return true
    if (hrId && testHrIds.has(hrId)) return true
    return false
  }).length
  const allConf = await db.copilotActionConfirmation.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, payload: true, resultResourceId: true, resultResourceType: true },
  })
  const copilotConfirmations = allConf.filter(c => {
    const payload = (c.payload as any) ?? {}
    if (payload.candidateId && testCandIds.has(payload.candidateId)) return true
    if (payload.hiringRequestId && testHrIds.has(payload.hiringRequestId)) return true
    if (c.resultResourceId && (testCandIds.has(c.resultResourceId) || testHrIds.has(c.resultResourceId) || testUserIds.has(c.resultResourceId))) return true
    return false
  }).length
  const auditLogs = 0

  // Potentially real
  const potentiallyRealUsers = allUsers.filter(u => !testUserIds.has(u.id)).length
  const potentiallyRealCandidates = allCands.filter(c => !testCandIds.has(c.id)).length
  const potentiallyRealHrs = allHrs.filter(h => !testHrIds.has(h.id)).length

  return {
    ok: true,
    data: {
      organization: { id: org.id, name: org.name, slug: org.slug },
      protected: { admins, promptTemplates, authSessions, invitations },
      removable: {
        testUsers,
        testCandidates: testCandIds.size,
        testHiringRequests: testHrIds.size,
        associated: {
          interviews,
          decisions,
          offers,
          activities,
          aiTasks,
          copilotConfirmations,
          auditLogs,
        },
      },
      potentiallyReal: {
        users: potentiallyRealUsers,
        candidates: potentiallyRealCandidates,
        hiringRequests: potentiallyRealHrs,
      },
    },
  }
}

// -----------------------------------------------------------------------------
// PART 2 — Execute cleanup
// -----------------------------------------------------------------------------

export interface ExecuteCleanupResult {
  removed: {
    users: number
    candidates: number
    hiringRequests: number
    interviews: number
    decisions: number
    offers: number
    activities: number
    aiTasks: number
    copilotConfirmations: number
    departments: number
  }
  preserved: {
    organization: string
    admins: number
    promptTemplates: number
    auditLogs: number
  }
}

export async function executeDataCleanup(
  ctx: { organizationId: string; userId: string; role: string },
  confirmation: string,
): Promise<ServiceResult<ExecuteCleanupResult>> {
  if (!hasPermission(ctx.role as any, 'organization.manage' as any)) {
    return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Only ADMIN can run data cleanup.' } }
  }
  if (confirmation.trim() !== 'CLEAN DEMO DATA') {
    return { ok: false, error: { code: 'CONFIRMATION_REQUIRED', message: 'You must type "CLEAN DEMO DATA" to confirm.' } }
  }

  // Pre-compute orphan department IDs OUTSIDE the main transaction so
  // the transaction stays short.
  const allDeptsOuter = await db.department.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, slug: true },
  })
  const orphanDeptIdsOuter: string[] = []
  for (const d of allDeptsOuter) {
    const userCount = await db.user.count({ where: { departmentId: d.id } })
    const hrCount = await db.hiringRequest.count({ where: { departmentId: d.id } })
    if (userCount > 0 || hrCount > 0) continue
    if (!/test|dept/i.test(d.slug)) continue
    orphanDeptIdsOuter.push(d.id)
  }

  // Re-classify inside the transaction
  const result = await db.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: ctx.organizationId } })
    if (!org) throw new Error('Organization not found')

    // Find test users
    const allUsers = await tx.user.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true },
    })
    // Identify test users, BUT preserve the calling ADMIN and ALL active
    // ADMINs (PART 2: preserve the current ADMIN account).
    const testUserIds = new Set(
      allUsers
        .filter(isTestUser)
        .filter(u => u.id !== ctx.userId) // never delete the caller
        .filter(u => u.role !== 'ADMIN') // never delete any ADMIN by pattern
        .map(u => u.id),
    )

    // Find test candidates
    const allCands = await tx.candidate.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, email: true, firstName: true, lastName: true },
    })
    const testCandIds = new Set(allCands.filter(isTestCandidate).map(c => c.id))

    // Find test hiring requests
    const allHrs = await tx.hiringRequest.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, title: true },
    })
    const testHrIds = new Set(allHrs.filter(isTestHiringRequest).map(h => h.id))

    // Step 0: re-assign HRs created by test users to the calling ADMIN
    // (so we can delete the test users without violating the Restrict FK).
    if (testUserIds.size > 0) {
      await tx.hiringRequest.updateMany({
        where: { organizationId: ctx.organizationId, createdById: { in: Array.from(testUserIds) } },
        data: { createdById: ctx.userId },
      })
    }

    // Step 1: delete ASSOCIATED records first
    const deletedInterviews = await tx.interview.deleteMany({
      where: {
        organizationId: ctx.organizationId,
        OR: [
          { hiringRequestId: { in: Array.from(testHrIds) } },
          { candidateId: { in: Array.from(testCandIds) } },
        ],
      },
    })
    const deletedDecisions = await tx.candidateDecision.deleteMany({
      where: {
        organizationId: ctx.organizationId,
        OR: [
          { hiringRequestId: { in: Array.from(testHrIds) } },
          { candidateId: { in: Array.from(testCandIds) } },
        ],
      },
    })
    const deletedOffers = await tx.offer.deleteMany({
      where: {
        organizationId: ctx.organizationId,
        OR: [
          { hiringRequestId: { in: Array.from(testHrIds) } },
          { candidateId: { in: Array.from(testCandIds) } },
        ],
      },
    })
    const deletedActivities = await tx.activity.deleteMany({
      where: {
        organizationId: ctx.organizationId,
        OR: [
          { hiringRequestId: { in: Array.from(testHrIds) } },
          { candidateId: { in: Array.from(testCandIds) } },
        ],
      },
    })
    // AI tasks
    const allAiTasks = await tx.aITask.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, metadata: true },
    })
    const aiTaskIds = allAiTasks
      .filter(t => {
        const meta = (t.metadata as any) ?? {}
        return (meta.candidateId && testCandIds.has(meta.candidateId)) ||
               (meta.hiringRequestId && testHrIds.has(meta.hiringRequestId))
      })
      .map(t => t.id)
    const deletedAiTasks = await tx.aITask.deleteMany({ where: { id: { in: aiTaskIds } } })
    // Copilot confirmations
    const allConf = await tx.copilotActionConfirmation.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, payload: true, resultResourceId: true },
    })
    const confIds = allConf
      .filter(c => {
        const payload = (c.payload as any) ?? {}
        if (payload.candidateId && testCandIds.has(payload.candidateId)) return true
        if (payload.hiringRequestId && testHrIds.has(payload.hiringRequestId)) return true
        if (c.resultResourceId && (
          testCandIds.has(c.resultResourceId) ||
          testHrIds.has(c.resultResourceId) ||
          testUserIds.has(c.resultResourceId)
        )) return true
        return false
      })
      .map(c => c.id)
    const deletedConfs = await tx.copilotActionConfirmation.deleteMany({ where: { id: { in: confIds } } })

    // Step 2: delete HiringRequests
    const deletedHrs = await tx.hiringRequest.deleteMany({ where: { id: { in: Array.from(testHrIds) } } })

    // Step 3: delete Candidates
    const deletedCands = await tx.candidate.deleteMany({ where: { id: { in: Array.from(testCandIds) } } })

    // Step 4: delete orphan departments
    const deletedDepts = orphanDeptIdsOuter.length > 0
      ? await tx.department.deleteMany({ where: { id: { in: orphanDeptIdsOuter } } })
      : { count: 0 }

    // Step 5: delete test Users
    const deletedUsers = await tx.user.deleteMany({ where: { id: { in: Array.from(testUserIds) } } })

    // Recount
    const preservedAdmins = await tx.user.count({ where: { organizationId: ctx.organizationId, role: 'ADMIN', status: 'ACTIVE' } })
    const preservedTemplates = await tx.promptTemplate.count({ where: { organizationId: ctx.organizationId } })
    const preservedAuditLogs = await tx.auditLog.count({ where: { organizationId: ctx.organizationId } })

    return {
      removed: {
        users: deletedUsers.count,
        candidates: deletedCands.count,
        hiringRequests: deletedHrs.count,
        interviews: deletedInterviews.count,
        decisions: deletedDecisions.count,
        offers: deletedOffers.count,
        activities: deletedActivities.count,
        aiTasks: deletedAiTasks.count,
        copilotConfirmations: deletedConfs.count,
        departments: deletedDepts.count,
      },
      preserved: {
        organization: org.name,
        admins: preservedAdmins,
        promptTemplates: preservedTemplates,
        auditLogs: preservedAuditLogs,
      },
    }
  }, { timeout: 30000, maxWait: 10000 })

  // Audit
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: 'DATA_CLEANUP_EXECUTED' as never,
    targetType: 'organization',
    targetId: ctx.organizationId,
    outcome: 'success',
    metadata: {
      cleanupId: randomUUID(),
      removed: result.removed,
      preserved: result.preserved,
    } as any,
  })

  return { ok: true, data: result }
}
