/**
 * GET /api/candidate-name/[id]
 *
 * Returns the candidate's display name, position (hiring request title),
 * and current stage. Used by the Interview Kit page to render the
 * header before the full kit is loaded.
 */

import { NextResponse } from 'next/server'

import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const candidate = await db.candidate.findUnique({
    where: { id },
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
