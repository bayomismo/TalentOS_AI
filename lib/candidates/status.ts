/**
 * Sprint 19 — `Candidate.status` mirror (audit P1-27).
 *
 * `Candidate.status` (`ACTIVE | HIRED | REJECTED | WITHDRAWN | BLACKLISTED`)
 * used to be dead duplicate state: every write path set `ACTIVE` and
 * nothing ever read the column. That is dangerous — a future reader that
 * trusts `status` gets a wrong answer.
 *
 * This module makes the column a REAL, consistently-maintained mirror of
 * `Candidate.stage`:
 *
 *   - `deriveCandidateStatus(stage)` is the pure mapping.
 *   - `syncCandidateStatus(tx, candidateId, stage?)` persists the mirror
 *     inside the caller's transaction.
 *
 * `BLACKLISTED` is RESERVED and NOT ACTIVE. There is no blacklist
 * capability in the product: no column stores a blacklist entry, no
 * action sets the value, and nothing reads it. It is declared in the
 * Prisma enum for forward compatibility only. Do NOT write it — a
 * blacklisted candidate would be indistinguishable from a rejected one
 * in every pipeline view, and no rule would exclude them from a
 * requisition. When a blacklist feature is implemented it must bring its
 * own model, its own rule and its own audit trail; it must not be
 * smuggled in through this mirror.
 *
 * PUBLIC API (other tracks depend on this — see the fix-candidates
 * deliverable):
 *
 *   deriveCandidateStatus(stage: ApplicationStage | string): CandidateStatus
 *   syncCandidateStatus(
 *     tx: Prisma.TransactionClient,
 *     candidateId: string,
 *     stage?: ApplicationStage | string,
 *   ): Promise<CandidateStatus>
 */

import type { ApplicationStage, CandidateStatus, Prisma } from '@prisma/client'

/**
 * The single mapping from pipeline stage to the `Candidate.status`
 * mirror. Terminal stages map to their own status; every live stage
 * maps to `ACTIVE`.
 *
 * The mapping is written against the string values so it works with a
 * raw column read (`candidate.stage`) as well as the enum.
 */
export function deriveCandidateStatus(stage: ApplicationStage | string): CandidateStatus {
  switch (stage) {
    case 'HIRED':
      return 'HIRED' as CandidateStatus
    case 'REJECTED':
      return 'REJECTED' as CandidateStatus
    case 'WITHDRAWN':
      return 'WITHDRAWN' as CandidateStatus
    default:
      // APPLIED | SCREENING | INTERVIEW | OFFER — still in the pipeline.
      return 'ACTIVE' as CandidateStatus
  }
}

/**
 * Writes the `status` mirror for a candidate inside the caller's
 * transaction.
 *
 * When `stage` is omitted the candidate's current stage is read from
 * the database first, so the call can be made after any stage write.
 * Returns the status that was persisted.
 *
 * It never throws for a missing candidate: a deleted candidate has no
 * mirror to keep. Every other database error propagates so the
 * caller's transaction rolls back.
 */
export async function syncCandidateStatus(
  tx: Prisma.TransactionClient,
  candidateId: string,
  stage?: ApplicationStage | string,
): Promise<CandidateStatus | null> {
  let current = stage
  if (current === undefined) {
    const row = await tx.candidate.findUnique({
      where: { id: candidateId },
      select: { stage: true },
    })
    if (!row) return null
    current = row.stage
  }

  const status = deriveCandidateStatus(current)
  await tx.candidate.update({
    where: { id: candidateId },
    data: { status },
  })
  return status
}

/**
 * The stages that count as "the candidate is still in the pipeline".
 *
 * Used by the capacity guard (audit P1-25): a candidate in a terminal
 * stage does not occupy an opening, so they are not "active".
 */
export const ACTIVE_APPLICATION_STAGES: readonly ApplicationStage[] = [
  'APPLIED' as ApplicationStage,
  'SCREENING' as ApplicationStage,
  'INTERVIEW' as ApplicationStage,
  'OFFER' as ApplicationStage,
]
