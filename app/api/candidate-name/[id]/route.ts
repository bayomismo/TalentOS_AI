/**
 * GET /api/candidate-name/[id]
 *
 * Returns the candidate's display name, position (hiring request title),
 * and current stage. Used by the Interview Kit page to render the
 * header before the full kit is loaded.
 *
 * Access control (audit D5 — a cross-tenant read found during the
 * business-flow remediation):
 *   - the caller must be authenticated and hold `candidate.view`,
 *   - the candidate is looked up through the caller's organization
 *     (a foreign-key filter on the candidate's own `organizationId`),
 *     so a candidate belonging to another tenant is not found.
 *
 * The route answers 404 rather than 403 for a foreign candidate, so it
 * does not disclose that the candidate exists elsewhere.
 */

import { NextResponse } from 'next/server'

import { requirePermission } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission('candidate.view')
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: 'You do not have access to candidates.' } },
      { status: auth.code === 'UNAUTHENTICATED' ? 401 : 403 },
    )
  }

  const { id } = await params
  const candidate = await db.candidate.findFirst({
    where: { id, organizationId: auth.data.organizationId },
    select: {
      firstName: true,
      lastName: true,
      stage: true,
      hiringRequest: { select: { title: true } },
    },
  })
  if (!candidate) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  return NextResponse.json({
    name: `${candidate.firstName} ${candidate.lastName}`,
    position: candidate.hiringRequest.title,
    stage: candidate.stage,
  })
}
