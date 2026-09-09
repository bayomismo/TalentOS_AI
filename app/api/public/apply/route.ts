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
import { MAX_CV_BASE64_CHARS } from '@/app/(public)/jobs/[slug]/apply-schema'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Largest body we will read into memory. Comfortably covers a max-size
// base64 CV plus every other field; anything bigger is rejected before
// `req.json()` buffers it.
const MAX_BODY_BYTES = MAX_CV_BASE64_CHARS + 256 * 1024

export async function POST(req: NextRequest) {
  const declaredLength = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: { code: 'CV_TOO_LARGE', message: 'Your application is too large. Please reduce the CV file size.' } },
      { status: 413 },
    )
  }

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

  // The action validates `body` structurally (zod) before using it.
  const result = await submitPublicApplicationAction(body, { ip, userAgent })

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
