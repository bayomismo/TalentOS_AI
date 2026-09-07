'use server'

/**
 * Sprint 10 — Candidate-side offer eligibility helper.
 *
 * Returns the SELECTED hiring request for a candidate, if any, so the
 * Create Offer page can pre-fill the position and verify the
 * (candidate, hiring-request) pair.
 */

import 'server-only'
import { requireAuth } from '@/lib/auth/authorize'
import { requirePermission } from '@/lib/auth/authorize'
import { toActionFailure } from '@/lib/auth/adapter'
import { db } from '@/lib/db'
import type { ActionResult } from '@/lib/auth/action-helpers'

export async function getSelectedHiringRequestForCandidateAction(
  candidateId: string,
): Promise<ActionResult<{ hiringRequestId: string; title: string } | null>> {
  const auth = await requireAuth()
  if (!auth.ok) return toActionFailure(auth)
  const perm = await requirePermission('offer.view')
  if (!perm.ok) return toActionFailure(perm)
  const decision = await db.candidateDecision.findFirst({
    where: {
      candidateId,
      candidate: { organizationId: auth.data.organizationId },
      decision: 'SELECTED' as never,
    },
    orderBy: { decidedAt: 'desc' },
    include: { hiringRequest: { select: { id: true, title: true } } },
  })
  if (!decision) return { ok: true, data: null }
  return {
    ok: true,
    data: { hiringRequestId: decision.hiringRequestId, title: decision.hiringRequest.title },
  }
}
