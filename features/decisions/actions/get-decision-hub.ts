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
import { ApplicationStage } from '@prisma/client'
import { getEventBus } from '@/lib/events'
import { recordAuditLog, requireAuth, requirePermission } from '@/lib/auth'
import { toActionFailure } from '@/lib/auth/adapter'
import { canReceiveDecisionOrOffer } from '@/lib/candidates/state-machine'
import { transitionCandidateStage } from '@/lib/candidates/transition'
import {
  appendDecisionTx,
  buildComparisonView,
  buildDecisionHubView,
  createDecisionActivity,
  createDecisionActivityTx,
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
    if (!result.ok) {
      // The service's own error code and its STRUCTURED details are
      // surfaced, not flattened into a generic INTERNAL message: a
      // schema-validation failure carries the Zod issues the corrective
      // retry was built from, and the reviewer needs to see them.
      return {
        ok: false,
        error: {
          code: result.error.code,
          message: result.error.message,
          retryable: result.error.retryable ?? true,
          details: result.error.details,
        },
      }
    }
    return { ok: true, data: result.data }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Failed to generate Decision Brief', retryable: true } }
  }
}

// -----------------------------------------------------------------------------
// 5. Record human decision
// -----------------------------------------------------------------------------

/**
 * Audit P2-03 — the AI may RECOMMEND, never DECIDE.
 *
 * The stage a decision maps to is defined here, by a human action, and
 * the AI recommendation (`candidate.recommendation`) is never a trigger
 * for a stage change. A rejection always requires a human decision of
 * REJECT, recorded by somebody holding `decision.record`.
 */
const DECISION_TARGET_STAGE = {
  SELECTED: ApplicationStage.OFFER,
  REJECT: ApplicationStage.REJECTED,
} as const

/**
 * Audit P1-20 — what ADVANCE means.
 *
 * ADVANCE moves the candidate one step along the pre-offer ladder:
 * APPLIED → SCREENING → INTERVIEW. It deliberately stops there: moving
 * to OFFER is what SELECTED means, and an offer additionally requires a
 * recorded SELECTED decision (see `lib/offers/eligibility.ts`). ADVANCE
 * must never be a way around the human decision.
 */
const ADVANCE_TARGET_STAGE: Partial<Record<ApplicationStage, ApplicationStage>> = {
  [ApplicationStage.APPLIED]: ApplicationStage.SCREENING,
  [ApplicationStage.SCREENING]: ApplicationStage.INTERVIEW,
}

/**
 * A refusal raised inside the decision transaction. Throwing it rolls
 * the transaction back — the decision row, the stage change and the
 * activity all disappear together, so a refused decision leaves NO
 * trace (audit A11).
 */
class DecisionRefused extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'DecisionRefused'
  }
}

export async function recordDecisionAction(
  input: RecordDecisionInput,
): Promise<
  ActionResult<{
    decisionId: string
    decision: string
    /** True when the decision actually moved `candidate.stage`. False for
     *  HOLD, which parks the candidate without changing their stage. */
    stageUpdated: boolean
    /** The stage the candidate is in after the decision. */
    stage: string
  }>
> {
  try {
    // PART 13: requires decision.record. Tenant-scoped.
    const auth = await requirePermission('decision.record')
    if (!auth.ok) return toActionFailure(auth)
    const orgId = auth.data.organizationId

    // IDOR guard: candidate must belong to this org.
    const candidate = await db.candidate.findFirst({
      where: { id: input.candidateId, organizationId: orgId },
      select: {
        id: true,
        organizationId: true,
        hiringRequestId: true,
        stage: true,
        firstName: true,
        lastName: true,
        // Audit P2-03 — the AI recommendation is advisory. It is read
        // only to be recorded next to the human decision, never to
        // derive it.
        recommendation: true,
      },
    })
    if (!candidate) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Candidate not found', retryable: false } }
    }
    if (input.hiringRequestId !== candidate.hiringRequestId) {
      return {
        ok: false,
        error: {
          code: 'CANDIDATE_MISMATCH',
          message: 'Candidate does not belong to this hiring request.',
          retryable: false,
        },
      }
    }

    // -----------------------------------------------------------------------
    // Audit P0-10 — a terminal candidate can no longer be decided on.
    //
    // The stage transition is validated by the state machine, so
    // REJECTED → REJECTED / OFFER would be refused anyway — but as an
    // INTERNAL-style crash or a silent no-op, not as a business refusal.
    // The guard is explicit, names the stage, and happens BEFORE any
    // write, so a refused decision leaves no decision row and no
    // activity behind.
    // -----------------------------------------------------------------------
    if (!canReceiveDecisionOrOffer(candidate.stage)) {
      return {
        ok: false,
        error: {
          code: 'TERMINAL_STAGE',
          message:
            `${candidate.firstName} ${candidate.lastName} is at stage ${candidate.stage}. ` +
            'A candidate in a terminal stage (HIRED, REJECTED or WITHDRAWN) cannot be decided on again.',
          retryable: false,
        },
      }
    }

    // -----------------------------------------------------------------------
    // Which stage does this decision map to?
    // -----------------------------------------------------------------------
    let targetStage: ApplicationStage | null = null
    if (input.decision === 'SELECTED' || input.decision === 'REJECT') {
      targetStage = DECISION_TARGET_STAGE[input.decision]
    } else if (input.decision === 'ADVANCE') {
      targetStage = ADVANCE_TARGET_STAGE[candidate.stage] ?? null
      if (!targetStage) {
        return {
          ok: false,
          error: {
            code: 'INVALID_STAGE_TRANSITION',
            message:
              `ADVANCE only moves a candidate from Applied to Screening or from Screening to Interview. ` +
              `${candidate.firstName} ${candidate.lastName} is at stage ${candidate.stage} — ` +
              'use SELECTED to move a candidate to Offer.',
            retryable: false,
          },
        }
      }
    }
    // HOLD parks the candidate: no stage change, but a decision row and
    // an activity are written, so the hold is visible in the timeline
    // and blocks an offer until a new decision replaces it.

    // The stored AI recommendation — advisory only.
    const candidateAiRecommendation = candidate.recommendation ?? null

    const eventType =
      input.decision === 'SELECTED' ? 'CANDIDATE_SELECTED'
        : input.decision === 'REJECT' ? 'CANDIDATE_REJECTED'
        : input.decision === 'HOLD' ? 'CANDIDATE_HELD'
        : 'CANDIDATE_ADVANCED'

    // -----------------------------------------------------------------------
    // One transaction: the decision row, the stage change and the
    // activity that records them commit together (audit P2-28). If the
    // stage transition is illegal, the whole thing rolls back and the
    // caller gets a clean business refusal — the `stageUpdated` flag is
    // never set and never ignored.
    // -----------------------------------------------------------------------
    let outcome:
      | {
          ok: true
          data: {
            decisionId: string
            decision: RecordDecisionInput['decision']
            stageUpdated: boolean
            stage: string
            decidedAt: Date
            decidedByName: string | null
            activity: {
              id: string
              type: string
              title: string
              description: string | null
              occurredAt: Date
              actor: { firstName: string; lastName: string } | null
              candidate: { firstName: string; lastName: string } | null
            }
          }
        }
      | { ok: false; error: { code: string; message: string; retryable: boolean } }

    try {
      outcome = await db.$transaction(async (tx) => {
        // The decision log is append-only (audit P2-18). Read the
        // current decision so the new row can supersede it.
        const previous = await tx.candidateDecision.findFirst({
          where: { candidateId: candidate.id, hiringRequestId: candidate.hiringRequestId },
          orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }],
          select: { id: true, decidedAt: true },
        })

        // Keep `decidedAt` strictly increasing so "the latest decision"
        // is unambiguous even when two decisions land in the same
        // millisecond.
        const now = Date.now()
        const decidedAt = new Date(
          previous ? Math.max(now, previous.decidedAt.getTime() + 1) : now,
        )

        const decision = await appendDecisionTx(tx, {
          organizationId: candidate.organizationId,
          candidateId: candidate.id,
          hiringRequestId: candidate.hiringRequestId,
          decision: input.decision,
          notes: input.notes,
          reason: input.reason,
          decidedById: auth.data.userId,
          supersedesId: previous?.id ?? null,
          decidedAt,
        })

        let stageUpdated = false
        let stage: string = candidate.stage
        if (targetStage) {
          const moved = await transitionCandidateStage(tx, {
            candidateId: candidate.id,
            toStage: targetStage,
            actorId: auth.data.userId,
            reason: input.reason ?? null,
          })
          if (!moved.ok) {
            // Roll the whole thing back — a decision that cannot be
            // executed must not leave a row behind.
            throw new DecisionRefused(moved.error.code, moved.error.message)
          }
          stageUpdated = true
          stage = moved.data.toStage
        }

        const activity = await createDecisionActivityTx(tx, {
          organizationId: candidate.organizationId,
          type: eventType,
          actorId: auth.data.userId,
          candidateId: candidate.id,
          hiringRequestId: candidate.hiringRequestId,
          candidateDecisionId: decision.id,
          title: `${candidate.firstName} ${candidate.lastName} → ${input.decision.toLowerCase()}`,
          description: input.notes,
          // The previous decision — never the new row itself. The row
          // did not exist when this id was chosen, so a decision can
          // never point at itself as its own predecessor (audit P2-18).
          metadata: {
            decision: input.decision,
            reason: input.reason ?? null,
            previousDecisionId: previous?.id ?? null,
            stageUpdated,
            stage,
            // Audit P2-03 — this row is a HUMAN decision. The stored AI
            // recommendation is recorded next to it as an advisory
            // signal, never as the reason for the outcome.
            humanDecision: true,
            decidedById: auth.data.userId,
            aiRecommendation: candidateAiRecommendation,
          },
        })

        return {
          ok: true as const,
          data: {
            decisionId: decision.id,
            decision: input.decision,
            stageUpdated,
            stage,
            decidedAt: decision.decidedAt,
            decidedByName: decision.decidedBy
              ? `${decision.decidedBy.firstName} ${decision.decidedBy.lastName}`
              : null,
            activity,
          },
        }
      })
    } catch (err) {
      if (err instanceof DecisionRefused) {
        return {
          ok: false,
          error: { code: err.code, message: err.message, retryable: false },
        }
      }
      throw err
    }

    if (!outcome.ok) return outcome

    const { decisionId, decision, stageUpdated, stage, decidedAt, decidedByName, activity } = outcome.data

    const bus = getEventBus()
    bus.publish({
      type: 'CandidateDecisionRecorded',
      payload: {
        decisionId,
        candidateId: candidate.id,
        hiringRequestId: candidate.hiringRequestId,
        decision,
        decidedByName: decidedByName ?? 'Unknown',
        decidedAt: decidedAt.toISOString(),
      },
    })

    await recordAuditLog({
      organizationId: candidate.organizationId,
      actorId: auth.data.userId,
      action: 'HUMAN_DECISION_RECORDED',
      targetType: 'candidate_decision',
      targetId: decisionId,
      outcome: 'success',
      metadata: { candidateId: candidate.id, decision, stageUpdated, stage },
    })

    safeRevalidate(`/hiring-requests/${candidate.hiringRequestId}/decision`)
    safeRevalidate(`/candidates/${candidate.id}`)

    return { ok: true, data: { decisionId, decision, stageUpdated, stage } }
  } catch (err) {
    return { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Failed to record decision', retryable: true } }
  }
}
