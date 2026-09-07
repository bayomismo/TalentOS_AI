/**
 * Sprint 17 — Google OAuth callback.
 *
 * GET /api/google/callback?code=...&state=...
 *
 * Google redirects here after the user grants consent. We exchange
 * the code for tokens, store the (encrypted) refresh token, and
 * bounce the user back to /settings.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth/auth'
import { parseOAuthState, isGoogleConfigured } from '@/lib/integrations/google/oauth'
import { completeGoogleConnect } from '@/lib/integrations/google/service'
import { recordAuditLog } from '@/lib/auth/audit'

export async function GET(req: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google Calendar is not configured.' }, { status: 503 })
  }

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  const userOrgId = (session.user as { organizationId?: string }).organizationId
  const role = (session.user as { role?: string }).role
  if (role !== 'ADMIN' || !userOrgId) {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const settingsUrl = new URL('/settings', req.url)
  settingsUrl.searchParams.set('section', 'integrations')

  if (error) {
    settingsUrl.searchParams.set('googleError', error)
    return NextResponse.redirect(settingsUrl)
  }
  if (!code || !state) {
    settingsUrl.searchParams.set('googleError', 'missing_params')
    return NextResponse.redirect(settingsUrl)
  }

  const parsed = parseOAuthState(state)
  if (!parsed) {
    settingsUrl.searchParams.set('googleError', 'bad_state')
    return NextResponse.redirect(settingsUrl)
  }

  // Verify the state org matches the caller's org (anti-CSRF)
  if (parsed.orgId !== userOrgId) {
    settingsUrl.searchParams.set('googleError', 'org_mismatch')
    return NextResponse.redirect(settingsUrl)
  }

  const appUrl = process.env.APP_URL || 'https://talentos-ai-lime.vercel.app'
  const result = await completeGoogleConnect({ code, organizationId: userOrgId, appUrl })
  if (!result.ok) {
    settingsUrl.searchParams.set('googleError', encodeURIComponent(result.error))
    return NextResponse.redirect(settingsUrl)
  }

  await recordAuditLog({
    organizationId: userOrgId,
    actorId: session.user.id,
    action: 'GOOGLE_INTEGRATION_CONNECTED' as never,
    targetType: 'integration',
    targetId: 'google-calendar',
    outcome: 'success',
  }).catch(() => null)

  settingsUrl.searchParams.set('googleConnected', '1')
  return NextResponse.redirect(settingsUrl)
}
