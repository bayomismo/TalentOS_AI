/**
 * GET /api/candidate-name/[id]
 *
 * Returns the candidate's display name, position (hiring request title),
 * and current stage. Used by the Interview Kit page to render the
 * header before the full kit is loaded.
 *
 * Auth: requires an authenticated session. The candidate lookup is
 * scoped to the caller's organization — a candidate that belongs to
 * another tenant returns 404 and never leaks its data. Middleware only
 * checks for the *presence* of a session cookie, so this route must do
 * its own identity + tenant check (see lib/auth/authorize.ts).
 */

import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth/authorize'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: 401 })
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
