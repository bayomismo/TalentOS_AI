/**
 * Sprint 19 — Vercel Cron entrypoint for offer expiry (audit P1-04).
 *
 * GET /api/cron/offer-expiry
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron
 * sends this header automatically when you set the secret).
 *
 * Idempotent: an offer that is already EXPIRED is never touched again,
 * and an offer whose status moved on (accepted / withdrawn) is skipped.
 *
 * Vercel config (vercel.json):
 *   { "crons": [{ "path": "/api/cron/offer-expiry", "schedule": "0 * * * *" }] }
 *
 * The same backstop runs lazily on the offer read paths, so an offer is
 * never more than a page-view away from being expired even if the cron
 * has not run yet.
 */

import { NextRequest, NextResponse } from 'next/server'
import { expireStaleOffers } from '@/lib/offers/expiry'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  // If no CRON_SECRET is set, allow in dev (so the route is callable
  // from a script). In production, Vercel always sends the auth header.
  if (expected) {
    const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (got !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    // Production without a secret = misconfigured. Fail closed.
    return NextResponse.json(
      { error: 'CRON_SECRET not set in production' },
      { status: 500 },
    )
  }

  const result = await expireStaleOffers()
  return NextResponse.json({
    ok: true,
    expired: result.expired,
    alreadyExpired: result.alreadyExpired,
    expiredOfferIds: result.expiredOfferIds,
    skipped: result.skipped,
  })
}
