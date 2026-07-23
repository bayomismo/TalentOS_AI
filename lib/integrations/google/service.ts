/**
 * Sprint 17 — Google Calendar integration service.
 *
 * Encapsulates the connect/disconnect/status flow + the per-interview
 * sync (create / update / delete) so the rest of the codebase never
 * has to know about Google.
 *
 * Every public function here is tenant-scoped via `organizationId`.
 * No function touches a row that doesn't belong to the caller.
 */

import { db } from '@/lib/db'
import { decryptToken, encryptToken } from './encrypt'
import {
  isGoogleConfigured,
  buildAuthUrl,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  mintAccessToken,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getOAuthState,
  type CalendarEventInput,
} from './oauth'

export type GoogleStatus =
  | { status: 'not_configured'; reason: string }
  | { status: 'disconnected' }
  | { status: 'connected'; googleEmail: string; googleName: string | null; connectedAt: Date }

export async function getGoogleStatus(organizationId: string): Promise<GoogleStatus> {
  if (!isGoogleConfigured()) {
    return {
      status: 'not_configured',
      reason: 'Google Calendar is not configured on this server. The platform admin needs to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    }
  }
  const row = await db.googleIntegration.findUnique({
    where: { organizationId },
    select: { googleEmail: true, googleName: true, connectedAt: true, disconnectedAt: true },
  })
  if (!row || row.disconnectedAt) return { status: 'disconnected' }
  return {
    status: 'connected',
    googleEmail: row.googleEmail,
    googleName: row.googleName,
    connectedAt: row.connectedAt,
  }
}

export function buildGoogleConnectUrl(organizationId: string, appUrl: string): string {
  const state = getOAuthState(organizationId)
  return buildAuthUrl(`${appUrl}/api/google/callback`, state)
}

/**
 * Complete the OAuth flow. Called from the /api/google/callback route.
 * `state` must contain the organizationId (signed minimally).
 */
export async function completeGoogleConnect(args: {
  code: string
  organizationId: string
  appUrl: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const tokens = await exchangeCodeForTokens(args.code, `${args.appUrl}/api/google/callback`)
    if (!tokens.refresh_token) {
      return { ok: false, error: 'Google did not return a refresh token. Try disconnecting first, then reconnecting.' }
    }
    const userInfo = await fetchGoogleUserInfo(tokens.access_token)
    const encrypted = encryptToken(tokens.refresh_token)

    await db.googleIntegration.upsert({
      where: { organizationId: args.organizationId },
      create: {
        organizationId: args.organizationId,
        refreshTokenEncrypted: encrypted,
        googleEmail: userInfo.email,
        googleName: userInfo.name ?? null,
        scopes: tokens.scope.split(' '),
        connectedAt: new Date(),
      },
      update: {
        refreshTokenEncrypted: encrypted,
        googleEmail: userInfo.email,
        googleName: userInfo.name ?? null,
        scopes: tokens.scope.split(' '),
        connectedAt: new Date(),
        disconnectedAt: null,
        lastUsedAt: null,
      },
    })

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'OAuth completion failed.' }
  }
}

export async function disconnectGoogle(organizationId: string): Promise<void> {
  await db.googleIntegration.updateMany({
    where: { organizationId },
    data: { disconnectedAt: new Date() },
  })
}

/**
 * Get a valid access token for the org, or null if not connected.
 */
async function getAccessTokenForOrg(organizationId: string): Promise<string | null> {
  const row = await db.googleIntegration.findUnique({
    where: { organizationId },
    select: { refreshTokenEncrypted: true, disconnectedAt: true },
  })
  if (!row || row.disconnectedAt) return null
  const refresh = decryptToken(row.refreshTokenEncrypted)
  return mintAccessToken(refresh)
}

// ---------------------------------------------------------------------------
// Per-interview sync
// ---------------------------------------------------------------------------

/**
 * Create a Google Calendar event for an interview. Stores the mapping
 * so we can update/delete later. Returns the google event id.
 */
export async function syncInterviewCreate(args: {
  organizationId: string
  interviewId: string
  summary: string
  description?: string
  startIso: string
  endIso: string
  attendees?: { email: string }[]
  location?: string
  meetingUrl?: string
}): Promise<{ ok: true; googleEventId: string } | { ok: false; error: string; skipped?: boolean }> {
  if (!isGoogleConfigured()) return { ok: false, error: 'Google not configured', skipped: true }
  const accessToken = await getAccessTokenForOrg(args.organizationId)
  if (!accessToken) return { ok: false, error: 'Google not connected', skipped: true }

  try {
    const event = await createCalendarEvent(accessToken, 'primary', {
      summary: args.summary,
      description: args.description,
      startIso: args.startIso,
      endIso: args.endIso,
      attendees: args.attendees,
      location: args.location,
      meetingUrl: args.meetingUrl,
    } satisfies CalendarEventInput)

    await db.calendarEventMapping.upsert({
      where: { interviewId: args.interviewId },
      create: {
        organizationId: args.organizationId,
        interviewId: args.interviewId,
        googleEventId: event.id,
        googleCalendarId: 'primary',
        lastSyncedAt: new Date(),
      },
      update: {
        googleEventId: event.id,
        googleCalendarId: 'primary',
        lastSyncedAt: new Date(),
        deletedAt: null,
      },
    })

    await db.googleIntegration.updateMany({
      where: { organizationId: args.organizationId },
      data: { lastUsedAt: new Date() },
    }).catch(() => null)

    return { ok: true, googleEventId: event.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Create event failed' }
  }
}

export async function syncInterviewUpdate(args: {
  organizationId: string
  interviewId: string
  summary: string
  description?: string
  startIso: string
  endIso: string
  attendees?: { email: string }[]
  location?: string
  meetingUrl?: string
}): Promise<{ ok: true } | { ok: false; error: string; skipped?: boolean }> {
  if (!isGoogleConfigured()) return { ok: false, error: 'Google not configured', skipped: true }
  const accessToken = await getAccessTokenForOrg(args.organizationId)
  if (!accessToken) return { ok: false, error: 'Google not connected', skipped: true }

  const mapping = await db.calendarEventMapping.findUnique({
    where: { interviewId: args.interviewId },
    select: { googleEventId: true, googleCalendarId: true, deletedAt: true },
  })
  if (!mapping || mapping.deletedAt) {
    // No existing event — fall back to create
    return syncInterviewCreate(args)
  }

  try {
    await updateCalendarEvent(accessToken, mapping.googleCalendarId, mapping.googleEventId, {
      summary: args.summary,
      description: args.description,
      startIso: args.startIso,
      endIso: args.endIso,
      attendees: args.attendees,
      location: args.location,
      meetingUrl: args.meetingUrl,
    })
    await db.calendarEventMapping.update({
      where: { interviewId: args.interviewId },
      data: { lastSyncedAt: new Date() },
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Update event failed' }
  }
}

export async function syncInterviewDelete(args: {
  organizationId: string
  interviewId: string
}): Promise<{ ok: true } | { ok: false; error: string; skipped?: boolean }> {
  if (!isGoogleConfigured()) return { ok: false, error: 'Google not configured', skipped: true }
  const accessToken = await getAccessTokenForOrg(args.organizationId)
  if (!accessToken) return { ok: false, error: 'Google not connected', skipped: true }

  const mapping = await db.calendarEventMapping.findUnique({
    where: { interviewId: args.interviewId },
    select: { googleEventId: true, googleCalendarId: true },
  })
  if (!mapping) return { ok: true } // nothing to delete

  try {
    await deleteCalendarEvent(accessToken, mapping.googleCalendarId, mapping.googleEventId)
    await db.calendarEventMapping.update({
      where: { interviewId: args.interviewId },
      data: { deletedAt: new Date() },
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Delete event failed' }
  }
}
