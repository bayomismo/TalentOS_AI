/**
 * Sprint 17.6 — Public application API endpoint.
 *
 * POST /api/public/apply
 *
 * No auth. Used by the form on /jobs/[slug]/apply. Body is JSON.
 * Forwards to submitPublicApplicationAction.
 */
import { NextRequest, NextResponse } from 'next/server'
import { submitPublicApplicationAction } from '@/app/(public)/jobs/[slug]/apply-action'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } },
      { status: 400 },
    )
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null
  const userAgent = req.headers.get('user-agent')

  const result = await submitPublicApplicationAction(
    body as Parameters<typeof submitPublicApplicationAction>[0],
    { ip, userAgent },
  )

  if (result.ok) {
    return NextResponse.json({ ok: true, candidateId: result.candidateId })
  }

  // Map known field errors back to inline UI hints where possible
  const fieldErrors: Record<string, string> = {}
  if (result.code === 'INVALID_INPUT') {
    // Generic — UI shows the top-level message
  } else if (result.code === 'INVALID_EMAIL') {
    fieldErrors.email = result.message
  } else if (result.code === 'MISSING_CONSENT') {
    fieldErrors.consent = result.message
  }

  return NextResponse.json(
    { ok: false, error: { code: result.code, message: result.message }, fieldErrors },
    { status: result.code === 'RATE_LIMITED' ? 429 : 400 },
  )
}
