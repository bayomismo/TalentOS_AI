/**
 * Sprint 17 — Google OAuth start route.
 *
 * GET /api/google/connect?orgId=...
 *
 * Validates the caller is an ADMIN in the org, then redirects to
 * Google's authorization URL. The state param carries the orgId so
 * the callback can verify.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth/auth'
import { buildGoogleConnectUrl, isGoogleConfigured } from '@/lib/integrations/google/oauth'

export async function GET(req: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: 'Google Calendar is not configured on this server.' },
      { status: 503 },
    )
  }

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login?callbackUrl=/settings', req.url))
  }
  const orgId = (session.user as { organizationId?: string }).organizationId
  if (!orgId) {
    return NextResponse.json({ error: 'No organization' }, { status: 400 })
  }

  // Only ADMINs can connect integrations
  const role = (session.user as { role?: string }).role
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  }

  const appUrl = process.env.APP_URL || 'https://talentos-ai-lime.vercel.app'
  const url = buildGoogleConnectUrl(orgId, appUrl)
  return NextResponse.redirect(url)
}
