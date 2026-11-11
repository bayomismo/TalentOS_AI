/**
 * Sprint 17.6 / Sprint 19 — Public application API endpoint.
 *
 * POST /api/public/apply
 *
 * No auth. Used by the form on /jobs/[slug]/apply. Body is JSON.
 * Forwards to submitPublicApplicationAction.
 *
 * Sprint 19 (audit P2-07 / P2-08): the rate-limit key was the FIRST hop
 * of `x-forwarded-for`, a header the CLIENT controls. Two consequences:
 * a bot could mint unlimited buckets by rotating the header, and every
 * applicant behind a shared NAT shared one bucket. The IP below is
 * derived from headers the PLATFORM sets and overwrites.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  submitPublicApplicationAction,
  type SubmitPublicApplicationInput,
} from '@/app/(public)/jobs/[slug]/apply-action'
import { MAX_CV_BASE64_CHARS, applicationSchema } from '@/app/(public)/jobs/[slug]/apply-schema'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * The client IP, as seen by the platform.
 *
 * Resolution order — every source below is set by the hosting platform
 * (Vercel), not by the browser:
 *
 *   1. `x-vercel-forwarded-for` — Vercel's own client-IP header. It is
 *      set by the edge and overwrites anything the client sent.
 *   2. `x-real-ip` — the reverse proxy's client-IP header.
 *   3. `x-forwarded-for` — used ONLY as a last resort, and then the
 *      RIGHT-most hop is taken: the platform APPENDS the real client IP,
 *      so the first hop is the client-supplied one and must not be
 *      trusted.
 *
 * A missing header yields null; the caller then falls back to a shared
 * bucket rather than trusting a client value.
 */
function serverDerivedClientIp(req: NextRequest): string | null {
  const platform = req.headers.get('x-vercel-forwarded-for') ?? req.headers.get('x-real-ip')
  if (platform) {
    const value = platform.trim()
    if (value.length > 0) return value
  }

  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',')
    const last = hops[hops.length - 1]?.trim()
    if (last && last.length > 0) return last
  }

  return null
}

/** Reads a string field from an untrusted JSON body. */
function readString(raw: Record<string, unknown>, key: string): string {
  const v = raw[key]
  return typeof v === 'string' ? v : ''
}

/** Reads an optional string field from an untrusted JSON body. */
function readOptionalString(raw: Record<string, unknown>, key: string): string | null {
  const v = raw[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Narrows the untrusted JSON body into the action's input shape. */
function toSubmitInput(raw: Record<string, unknown>): SubmitPublicApplicationInput {
  const cvRaw = raw.cv
  let cv: SubmitPublicApplicationInput['cv'] = null
  if (cvRaw && typeof cvRaw === 'object' && !Array.isArray(cvRaw)) {
    const c = cvRaw as Record<string, unknown>
    const dataBase64 = typeof c.dataBase64 === 'string' ? c.dataBase64 : ''
    if (dataBase64.length > 0) {
      cv = {
        dataBase64,
        fileName: typeof c.fileName === 'string' ? c.fileName : '',
        mimeType: typeof c.mimeType === 'string' ? c.mimeType : '',
      }
    }
  }

  return {
    jobSlug: readString(raw, 'jobSlug'),
    firstName: readString(raw, 'firstName'),
    lastName: readString(raw, 'lastName'),
    email: readString(raw, 'email'),
    phone: readOptionalString(raw, 'phone'),
    location: readOptionalString(raw, 'location'),
    linkedinUrl: readOptionalString(raw, 'linkedinUrl'),
    portfolioUrl: readOptionalString(raw, 'portfolioUrl'),
    githubUrl: readOptionalString(raw, 'githubUrl'),
    coverLetter: readOptionalString(raw, 'coverLetter'),
    cv,
    website: readOptionalString(raw, 'website') ?? undefined,
    consent: typeof raw.consent === 'string' ? raw.consent : undefined,
  }
}

// Largest body we will read into memory. Comfortably covers a max-size
// base64 CV plus every other field; anything bigger is rejected before
// `req.json()` buffers it.
const MAX_BODY_BYTES = MAX_CV_BASE64_CHARS + 256 * 1024

export async function POST(req: NextRequest) {
  // Reject an oversized body on the declared content-length, before
  // `req.json()` buffers it into memory.
  const declaredLength = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'CV_TOO_LARGE',
          message: 'Your application is too large. Please reduce the CV file size.',
        },
      },
      { status: 413 },
    )
  }

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } },
      { status: 400 },
    )
  }

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } },
      { status: 400 },
    )
  }

  // Structural gate on the RAW body, BEFORE it is narrowed.
  //
  // The narrowing below (`toSubmitInput`) coerces every field to a string,
  // so a body with `firstName: 123` would arrive at the action as
  // `firstName: ''` — well-formed, and therefore past a gate that runs
  // after the narrowing. Validating the raw body first is what makes the
  // gate mean anything: a malformed body is rejected as INVALID_INPUT
  // instead of being silently coerced into a submission with empty
  // fields.
  const shape = applicationSchema.safeParse(parsedBody)
  if (!shape.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INVALID_INPUT',
          message:
            'Some of the details submitted were not in the expected format. Please check the form and try again.',
        },
      },
      { status: 400 },
    )
  }

  const ip = serverDerivedClientIp(req)
  const userAgent = req.headers.get('user-agent')

  // The body is narrowed into the action's input shape here, and the
  // action validates it structurally (zod) before using it.
  const result = await submitPublicApplicationAction(
    toSubmitInput(parsedBody as Record<string, unknown>),
    { ip, userAgent },
  )

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      candidateId: result.candidateId,
      reapplication: result.reapplication,
    })
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
