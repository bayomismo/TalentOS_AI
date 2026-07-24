'use server'

/**
 * Sprint 8 + 9 — Decision Hub server actions.
 *
 * Thin wrappers around the repository + service. Each action:
 *  - Authorizes the caller (Sprint 9 PART 13)
 *  - Verifies the requested resources belong to the caller's organization
 *    (Sprint 9 PART 6: IDOR guard)
 *  - Calls the repository / service
 *  - Emits events / activities via the service
 *  - Returns an ActionResult
 */

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getEventBus } from '@/lib/events'
import { recordAuditLog, requireAuth, requirePermission } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import {
  buildComparisonView,
  buildDecisionHubView,
  createDecisionActivity,
  findExistingDecision,
  upsertDecision,
} from '../repositories/decision-repository'
import { generateDecisionBriefService } from '../services/decision-brief-service'
import type {
  ActionResult,
  ComparisonView,
  DecisionHubView,
  DecisionBriefSummary,
  RecordDecisionInput,
  GenerateDecisionBriefInput,
} from '../types'

function safeRevalidate(path: string): void {
  try { revalidatePath(path) } catch { /* outside request context */ }
}

// -----------------------------------------------------------------------------
// 1. Get Decision Hub
// -----------------------------------------------------------------------------

export async function getDecisionHubAction(
  hiringRequestId: string,
): Promise<ActionResult<DecisionHubView>> {
  try {
    // PART 13: requires decision.view. Tenant-scoped.
    const auth = await requirePermission('decision.view')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    // PART 6: IDOR guard — verify HR belongs to this tenant.
    const hrCheck = await db.hiringRequest.findFirst({
      where: { id: hiringRequestId, organizationId: orgId },
      select: { id: true },
    })
    if (!hrCheck) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Hiring request not found', retryable: false } }
    }

    const view = await buildDecisionHubView(hiringRequestId, orgId)
    if (!view) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Hiring request not found', retryable: false } }
    }
    return { ok: true, data: view }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Failed to load Decision Hub', retryable: true } }
  }
}

// -----------------------------------------------------------------------------
// 2. Get Comparison View
// -----------------------------------------------------------------------------

export async function getComparisonAction(
  hiringRequestId: string,
  candidateIds: string[],
): Promise<ActionResult<ComparisonView>> {
  try {
    // PART 13: requires decision.compare. Tenant-scoped.
    const auth = await requirePermission('decision.compare')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    // IDOR guard
    const hrCheck = await db.hiringRequest.findFirst({
      where: { id: hiringRequestId, organizationId: orgId },
      select: { id: true },
    })
    if (!hrCheck) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Hiring request not found', retryable: false } }
    }
    const candCount = await db.candidate.count({
      where: { id: { in: candidateIds }, hiringRequestId, organizationId: orgId },
    })
    if (candCount !== candidateIds.length) {
      return { ok: false, error: { code: 'CANDIDATE_MISMATCH', message: 'Candidates do not belong to this hiring request.', retryable: false } }
    }

    const view = await buildComparisonView(hiringRequestId, orgId, candidateIds)
    if (!view) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Comparison could not be built', retryable: false } }
    }
    return { ok: true, data: view }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Failed to load comparison', retryable: true } }
  }
}

// -----------------------------------------------------------------------------
// 3. Log comparison viewed
// -----------------------------------------------------------------------------

export async function logComparisonViewedAction(
  hiringRequestId: string,
  candidateIds: string[],
): Promise<ActionResult<{ logged: boolean }>> {
  try {
    // PART 13: requires decision.compare to view a comparison.
    const auth = await requirePermission('decision.compare')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    const hr = await db.hiringRequest.findFirst({
      where: { id: hiringRequestId, organizationId: orgId },
      select: { id: true, organizationId: true, title: true },
    })
    if (!hr) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Hiring request not found', retryable: false } }
    }

    const bus = getEventBus()
    const activity = await createDecisionActivity({
      organizationId: hr.organizationId,
      type: 'COMPARISON_VIEWED',
      actorId: auth.data.userId,
      candidateId: candidateIds[0] ?? null,
      hiringRequestId: hr.id,
      title: `Comparison viewed for ${hr.title}`,
      description: `Compared ${candidateIds.length} candidate(s)`,
      metadata: { candidateIds },
    })
    bus.publish({ type: 'CandidateComparisonCreated', payload: { hiringRequestId: hr.id, candidateIds, viewedAt: new Date().toISOString() } })

    return { ok: true, data: { logged: true } }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Failed to log', retryable: true } }
  }
}

// -----------------------------------------------------------------------------
// 4. Generate Decision Brief
// -----------------------------------------------------------------------------

export async function generateDecisionBriefAction(
  input: GenerateDecisionBriefInput,
): Promise<ActionResult<DecisionBriefSummary>> {
  try {
    // PART 13: requires ai.generate_decision_brief. Tenant-scoped.
    const auth = await requirePermission('ai.generate_decision_brief')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    // IDOR guard: HR + all candidates must belong to this org.
    const hr = await db.hiringRequest.findFirst({
      where: { id: input.hiringRequestId, organizationId: orgId },
      select: { id: true, organizationId: true, title: true },
    })
    if (!hr) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Hiring request not found', retryable: false } }
    }
    if (input.candidateIds.length < 2 || input.candidateIds.length > 4) {
      return { ok: false, error: { code: 'VALIDATION', message: 'Brief requires 2 to 4 candidates.', retryable: false } }
    }
    const candCount = await db.candidate.count({
      where: { id: { in: input.candidateIds }, hiringRequestId: hr.id, organizationId: orgId },
    })
    if (candCount !== input.candidateIds.length) {
      return { ok: false, error: { code: 'CANDIDATE_MISMATCH', message: 'Candidates do not belong to this hiring request.', retryable: false } }
    }

    const result = await generateDecisionBriefService({
      hiringRequestId: hr.id,
      organizationId: orgId,
      candidateIds: input.candidateIds,
      actorId: auth.data.userId,
    })
    if (!result.ok) return { ok: false, error: { code: 'INTERNAL', message: result.error.message, retryable: result.error.retryable ?? true, details: result.error.details } }
    return { ok: true, data: result.data }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Failed to generate Decision Brief', retryable: true } }
  }
}

// -----------------------------------------------------------------------------
// 5. Record human decision
// -----------------------------------------------------------------------------

export async function recordDecisionAction(
  input: RecordDecisionInput,
): Promise<ActionResult<{ decisionId: string; decision: string }>> {
  try {
    // PART 13: requires decision.record. Tenant-scoped.
    const auth = await requirePermission('decision.record')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    // IDOR guard: candidate must belong to this org.
    const candidate = await db.candidate.findFirst({
      where: { id: input.candidateId, organizationId: orgId },
      select: { id: true, organizationId: true, hiringRequestId: true, firstName: true, lastName: true },
    })
    if (!candidate) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Candidate not found', retryable: false } }
    }

    const existing = await findExistingDecision(candidate.id, candidate.hiringRequestId)
    const decision = await upsertDecision({
      candidateId: candidate.id,
      hiringRequestId: candidate.hiringRequestId,
      organizationId: candidate.organizationId,
      decision: input.decision,
      notes: input.notes,
      reason: input.reason,
      decidedById: auth.data.userId,
    })

    // Sprint 18 — keep candidate.stage in sync with the decision so the
    // pipeline view reflects the human's choice. Without this, the activity
    // log says "Ada → selected" but the kanban / list still shows her in
    // INTERVIEW. State machine enforces the transition is legal.
    //
    //   SELECTED → OFFER (caller is committing to drafting an offer)
    //   REJECT   → REJECTED (terminal)
    //   HOLD     → no stage change (HOLD is a marker, not a stage)
    //   ADVANCE  → no stage change (e.g. moving to next round, but stage
    //              transitions are already done by bulkMoveCandidatesAction)
    let stageUpdated = false
    if (input.decision === 'SELECTED' || input.decision === 'REJECT') {
      const { validateStageTransition } = await import('@/lib/candidates/state-machine')
      const targetStage = input.decision === 'SELECTED' ? 'OFFER' : 'REJECTED'
      const fullCandidate = await db.candidate.findUnique({
        where: { id: candidate.id },
        select: { stage: true },
      })
      if (fullCandidate) {
        const transition = validateStageTransition(fullCandidate.stage, targetStage as any)
        if (transition.ok) {
          await db.candidate.update({
            where: { id: candidate.id },
            data: {
              stage: targetStage as any,
              ...(input.decision === 'REJECT' && { rejectedAt: new Date(), rejectedReason: input.reason ?? null }),
            },
          })
          stageUpdated = true
        }
      }
    }

    const bus = getEventBus()
    const eventType =
      input.decision === 'SELECTED' ? 'CANDIDATE_SELECTED'
        : input.decision === 'REJECT' ? 'CANDIDATE_REJECTED'
        : input.decision === 'HOLD' ? 'CANDIDATE_HELD'
        : 'CANDIDATE_ADVANCED'

    const activity = await createDecisionActivity({
      organizationId: candidate.organizationId,
      type: eventType,
      actorId: auth.data.userId,
      candidateId: candidate.id,
      hiringRequestId: candidate.hiringRequestId,
      candidateDecisionId: decision.id,
      title: `${candidate.firstName} ${candidate.lastName} → ${input.decision.toLowerCase()}`,
      description: input.notes,
      metadata: { decision: input.decision, reason: input.reason, previousDecisionId: existing?.id ?? null },
    })

    const activitySnapshot: import('@/lib/events/types').ActivitySnapshot = {
      id: activity.id,
      type: activity.type,
      title: activity.title,
      description: activity.description,
      actorName: activity.actor ? `${activity.actor.firstName} ${activity.actor.lastName}` : null,
      candidateName: activity.candidate ? `${activity.candidate.firstName} ${activity.candidate.lastName}` : null,
      occurredAt: activity.occurredAt.toISOString(),
    }
    bus.publish({
      type: 'CandidateDecisionRecorded',
      payload: {
        decisionId: decision.id,
        candidateId: candidate.id,
        hiringRequestId: candidate.hiringRequestId,
        decision: input.decision,
        decidedByName: activitySnapshot.actorName ?? 'Unknown',
        decidedAt: decision.decidedAt.toISOString(),
      },
    })

    await recordAuditLog({
      organizationId: candidate.organizationId,
      actorId: auth.data.userId,
      action: 'HUMAN_DECISION_RECORDED',
      targetType: 'candidate_decision',
      targetId: decision.id,
      outcome: 'success',
      metadata: { candidateId: candidate.id, decision: input.decision },
    })

    return { ok: true, data: { decisionId: decision.id, decision: input.decision, stageUpdated } }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Failed to record decision', retryable: true } }
  }
}
