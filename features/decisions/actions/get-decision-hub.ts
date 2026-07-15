'use server'

/**
 * Sprint 8 — Decision Hub server actions.
 *
 * Thin wrappers around the repository + service. Each action:
 *  - Validates input
 *  - Calls the repository / service
 *  - Emits events / activities via the service
 *  - Returns an ActionResult
 */

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getEventBus } from '@/lib/events'
import {
  buildComparisonView,
  buildDecisionHubView,
  createDecisionActivity,
  findExistingDecision,
  getDefaultActorIdForOrg,
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
  try {
    revalidatePath(path)
  } catch {
    // ignore
  }
}

function activitySnapshot(a: { id: string; type: string; title: string; description: string | null; occurredAt: Date }) {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    description: a.description,
    actorName: null,
    candidateName: null,
    occurredAt: a.occurredAt.toISOString(),
  }
}

// -----------------------------------------------------------------------------
// 1. getDecisionHubAction
// -----------------------------------------------------------------------------

export async function getDecisionHubAction(
  hiringRequestId: string
): Promise<ActionResult<DecisionHubView>> {
  try {
    const view = await buildDecisionHubView(hiringRequestId)
    if (!view) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Hiring request not found.', retryable: false } }
    }
    return { ok: true, data: view }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to load Decision Hub.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

// -----------------------------------------------------------------------------
// 2. getComparisonAction
// -----------------------------------------------------------------------------

export async function getComparisonAction(
  hiringRequestId: string,
  candidateIds: string[]
): Promise<ActionResult<ComparisonView>> {
  try {
    if (candidateIds.length < 2) {
      return { ok: false, error: { code: 'TOO_FEW_CANDIDATES', message: 'Select at least 2 candidates to compare.', retryable: false } }
    }
    if (candidateIds.length > 4) {
      return { ok: false, error: { code: 'TOO_MANY_CANDIDATES', message: 'At most 4 candidates can be compared at once.', retryable: false } }
    }
    const view = await buildComparisonView(hiringRequestId, candidateIds)
    if (!view) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Hiring request not found.', retryable: false } }
    }
    if (view.candidates.length !== candidateIds.length) {
      return {
        ok: false,
        error: { code: 'CANDIDATE_MISMATCH', message: 'One or more selected candidates do not belong to this hiring request.', retryable: false },
      }
    }
    return { ok: true, data: view }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to load comparison.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

// -----------------------------------------------------------------------------
// 3. logComparisonViewedAction
// -----------------------------------------------------------------------------

export async function logComparisonViewedAction(
  hiringRequestId: string,
  candidateIds: string[]
): Promise<ActionResult<{ logged: true }>> {
  const bus = getEventBus()
  try {
    const hr = await db.hiringRequest.findUnique({ where: { id: hiringRequestId }, select: { id: true, organizationId: true } })
    if (!hr) return { ok: false, error: { code: 'NOT_FOUND', message: 'Hiring request not found.', retryable: false } }
    const actorId = await getDefaultActorIdForOrg(hr.organizationId)
    const activity = await createDecisionActivity({
      organizationId: hr.organizationId,
      type: 'COMPARISON_VIEWED',
      actorId,
      candidateId: candidateIds[0] ?? '00000000-0000-0000-0000-000000000000',
      hiringRequestId: hr.id,
      title: `Compared ${candidateIds.length} candidate${candidateIds.length === 1 ? '' : 's'}`,
      metadata: { candidateIds },
    })
    bus.publish({
      type: 'CandidateComparisonCreated',
      payload: { hiringRequestId: hr.id, candidateIds, viewedAt: activity.occurredAt.toISOString() },
    })
    bus.publish({
      type: 'ActivityRecorded',
      payload: { activity: activitySnapshot({ ...activity, occurredAt: activity.occurredAt }) },
    })
    return { ok: true, data: { logged: true } }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to log comparison.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

// -----------------------------------------------------------------------------
// 4. generateDecisionBriefAction
// -----------------------------------------------------------------------------

export async function generateDecisionBriefAction(
  input: GenerateDecisionBriefInput
): Promise<ActionResult<DecisionBriefSummary>> {
  const result = await generateDecisionBriefService(input)
  if (result.ok) {
    safeRevalidate(`/hiring-requests/${input.hiringRequestId}/decision`)
    safeRevalidate(`/hiring-requests/${input.hiringRequestId}/decision/compare`)
  }
  return result
}

// -----------------------------------------------------------------------------
// 5. recordDecisionAction
// -----------------------------------------------------------------------------

export async function recordDecisionAction(
  input: RecordDecisionInput
): Promise<ActionResult<{ decisionId: string; decision: string; decidedAt: string; decidedByName: string }>> {
  const bus = getEventBus()
  try {
    if (!input.notes || input.notes.trim().length < 4) {
      return { ok: false, error: { code: 'NOTES_REQUIRED', message: 'Decision notes are required (min 4 characters).', retryable: false } }
    }
    if (!['ADVANCE', 'HOLD', 'REJECT', 'SELECTED'].includes(input.decision)) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'Invalid decision value.', retryable: false } }
    }
    const candidate = await db.candidate.findUnique({
      where: { id: input.candidateId },
      select: { id: true, organizationId: true, hiringRequestId: true, firstName: true, lastName: true },
    })
    if (!candidate) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Candidate not found.', retryable: false } }
    }
    if (candidate.hiringRequestId !== input.hiringRequestId) {
      return { ok: false, error: { code: 'CANDIDATE_MISMATCH', message: 'Candidate does not belong to this hiring request.', retryable: false } }
    }
    const actorId = await getDefaultActorIdForOrg(candidate.organizationId)

    const existing = await findExistingDecision(candidate.id, input.hiringRequestId)
    const decision = await upsertDecision({
      organizationId: candidate.organizationId,
      candidateId: candidate.id,
      hiringRequestId: input.hiringRequestId,
      decision: input.decision,
      notes: input.notes,
      reason: input.reason ?? null,
      decidedById: actorId,
    })

    const decisionActivityType = mapDecisionToActivityType(input.decision)
    const activity = await createDecisionActivity({
      organizationId: candidate.organizationId,
      type: decisionActivityType,
      actorId,
      candidateId: candidate.id,
      hiringRequestId: input.hiringRequestId,
      candidateDecisionId: decision.id,
      title: existing
        ? `Decision updated: ${input.decision.replace('_', ' ')}`
        : `Human decision: ${input.decision.replace('_', ' ')}`,
      description: input.notes,
      metadata: {
        decision: input.decision,
        reason: input.reason ?? null,
        actorName: decision.decidedBy
          ? `${decision.decidedBy.firstName} ${decision.decidedBy.lastName}`
          : 'Unknown',
      },
    })
    const evaluator = decision.decidedBy
    bus.publish({
      type: 'CandidateDecisionRecorded',
      payload: {
        decisionId: decision.id,
        candidateId: candidate.id,
        hiringRequestId: input.hiringRequestId,
        decision: input.decision,
        decidedByName: evaluator ? `${evaluator.firstName} ${evaluator.lastName}` : 'Unknown',
        decidedAt: decision.decidedAt.toISOString(),
      },
    })
    bus.publish({
      type: 'ActivityRecorded',
      payload: { activity: activitySnapshot({ ...activity, occurredAt: activity.occurredAt }) },
    })

    safeRevalidate(`/candidates/${candidate.id}`)
    safeRevalidate(`/hiring-requests/${input.hiringRequestId}/decision`)
    safeRevalidate(`/hiring-requests/${input.hiringRequestId}/candidates`)

    return {
      ok: true,
      data: {
        decisionId: decision.id,
        decision: input.decision,
        decidedAt: decision.decidedAt.toISOString(),
        decidedByName: evaluator ? `${evaluator.firstName} ${evaluator.lastName}` : 'Unknown',
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Failed to record decision.', retryable: true, details: err instanceof Error ? err.message : String(err) },
    }
  }
}

function mapDecisionToActivityType(decision: 'ADVANCE' | 'HOLD' | 'REJECT' | 'SELECTED'):
  | 'CANDIDATE_SELECTED'
  | 'CANDIDATE_HELD'
  | 'CANDIDATE_REJECTED'
  | 'CANDIDATE_ADVANCED' {
  switch (decision) {
    case 'SELECTED':
      return 'CANDIDATE_SELECTED'
    case 'HOLD':
      return 'CANDIDATE_HELD'
    case 'REJECT':
      return 'CANDIDATE_REJECTED'
    case 'ADVANCE':
      return 'CANDIDATE_ADVANCED'
  }
}
