/**
 * Sprint 19 — Shared candidate stage transition helper.
 *
 * ONE helper for every stage mutation in the product. It exists because
 * the business-flow audit found that stage writes were scattered across
 * at least five call sites, three of which never validated the
 * transition:
 *
 *   - the single-candidate move action (P0-09) wrote `stage` directly,
 *   - the public-apply action (P0-06) wrote `stage: 'APPLIED'` straight
 *     onto an existing candidate row, resurrecting rejected candidates
 *     and overwriting recruiter-curated fields,
 *   - the CV-upload path (P2-03 / P2-04) wrote the AI-recommended stage
 *     without validation.
 *
 * This helper makes the illegal transitions impossible to express from
 * the call site: the caller passes the target stage, and the helper
 * decides whether the move is legal.
 *
 * DESIGN RULES
 *   1. It takes a `Prisma.TransactionClient` — it NEVER imports
 *      `@/lib/db`. The caller owns the transaction, so the stage write,
 *      the Application mirror and whatever else the caller writes all
 *      commit or roll back together.
 *   2. An illegal transition is a RETURNED RESULT, never a thrown
 *      error: `{ ok: false, error: { code: 'INVALID_STAGE_TRANSITION' } }`.
 *      The caller decides how to surface it.
 *   3. A database error is NOT swallowed: it propagates so the caller's
 *      transaction rolls back. Silence here would be a lost write.
 *   4. It writes NO Activity and NO AuditLog rows. Those belong to the
 *      caller, which knows the actor and the surrounding business
 *      context.
 *
 * USAGE
 *
 *   const result = await db.$transaction(async (tx) => {
 *     const moved = await transitionCandidateStage(tx, {
 *       candidateId,
 *       toStage: ApplicationStage.SCREENING,
 *       actorId: auth.data.userId,
 *     })
 *     if (!moved.ok) return moved
 *     await tx.activity.create({ ... })
 *     return moved
 *   })
 *
 * TRANSACTION CLIENT CONTRACT
 *
 *   The helper uses exactly three calls on the transaction client:
 *
 *     tx.candidate.findUnique({ where: { id }, select: { stage: true } })
 *     tx.candidate.update({ where: { id }, data: {...}, select: { id, hiringRequestId } })
 *     tx.application.updateMany({ where: { candidateId, hiringRequestId }, data: { stage } })
 *
 *   A test double only has to implement those three. The Application
 *   mirror is skipped when the client does not expose the
 *   `application` model.
 */

import type { ApplicationStage, Prisma } from '@prisma/client'
import { validateStageTransition } from '@/lib/candidates/state-machine'

export interface StageTransitionInput {
  candidateId: string
  toStage: ApplicationStage
  actorId?: string | null
  reason?: string | null
  /** When true, skip the Application mirror (legacy paths only). */
  skipApplicationMirror?: boolean
}

export type StageTransitionResult =
  | { ok: true; data: { candidateId: string; fromStage: string; toStage: string } }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

/**
 * Moves a candidate to a new stage, inside the caller's transaction.
 *
 * On success the candidate row carries the new stage plus the lifecycle
 * timestamps that belong to it (`hiredAt`, `rejectedAt` +
 * `rejectedReason`, `withdrawnAt`) and a fresh `lastActivityAt`. The
 * matching `Application` row (same candidate, same hiring request) is
 * mirrored to the same stage when one exists.
 *
 * Returns a failure result — never throws — when the transition is
 * illegal or the candidate does not exist. Database errors propagate.
 */
export async function transitionCandidateStage(
  tx: Prisma.TransactionClient,
  input: StageTransitionInput,
): Promise<StageTransitionResult> {
  const candidate = await tx.candidate.findUnique({
    where: { id: input.candidateId },
    select: { stage: true },
  })

  if (!candidate) {
    return {
      ok: false,
      error: {
        code: 'CANDIDATE_NOT_FOUND',
        message: 'Candidate not found.',
        retryable: false,
      },
    }
  }

  const validation = validateStageTransition(candidate.stage, input.toStage)
  if (!validation.ok) {
    // Nothing is written on an illegal transition. The message names
    // both stages so the caller can show the user exactly what was
    // attempted.
    const reason = validation.reason
    const namesBothStages =
      reason.includes(candidate.stage) && reason.includes(input.toStage)
    return {
      ok: false,
      error: {
        code: 'INVALID_STAGE_TRANSITION',
        message: namesBothStages
          ? reason
          : `Cannot move candidate from ${candidate.stage} to ${input.toStage}. ${reason}`,
        retryable: false,
      },
    }
  }

  const now = new Date()

  const updated = await tx.candidate.update({
    where: { id: input.candidateId },
    data: {
      stage: input.toStage,
      ...(input.toStage === 'HIRED' ? { hiredAt: now } : {}),
      ...(input.toStage === 'REJECTED'
        ? { rejectedAt: now, rejectedReason: input.reason ?? null }
        : {}),
      ...(input.toStage === 'WITHDRAWN' ? { withdrawnAt: now } : {}),
      lastActivityAt: now,
    },
    select: { id: true, hiringRequestId: true },
  })

  // Mirror the stage onto the Application row for this candidate +
  // hiring request, when one exists. A candidate that predates the
  // Application entity (or was created by a legacy path) has no row to
  // mirror — that is a silent no-op, not an error.
  //
  // Guarded: a caller that passes a transaction client without the
  // `Application` model (a legacy path, or a test double) degrades to
  // "no mirror" instead of throwing. The real Prisma client always
  // exposes it.
  if (!input.skipApplicationMirror) {
    const applications = tx.application
    if (applications && typeof applications.updateMany === 'function') {
      await applications.updateMany({
        where: {
          candidateId: input.candidateId,
          hiringRequestId: updated.hiringRequestId,
        },
        data: { stage: input.toStage },
      })
    }
  }

  return {
    ok: true,
    data: {
      candidateId: input.candidateId,
      fromStage: candidate.stage,
      toStage: input.toStage,
    },
  }
}
