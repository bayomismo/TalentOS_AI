/**
 * Sprint 17 — Google OAuth + Calendar API client.
 *
 * Uses Google Identity (OAuth 2.0) to get a refresh token, then uses
 * that to mint access tokens on demand. No Google SDK dep — fetch
 * is fine and keeps the bundle small.
 *
 * Env vars required at runtime (set in Vercel):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   INTEGRATION_ENCRYPTION_KEY (32 bytes hex or base64)
 *   APP_URL (already set)
 *
 * If any of these are missing, `isGoogleConfigured()` returns false
 * and the UI hides the "Connect Google Calendar" button.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

export function isGoogleConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.INTEGRATION_ENCRYPTION_KEY
  )
}

export function getOAuthState(organizationId: string): string {
  // State is a signed-ish token. We just JSON-encode + base64 for now.
  // For production: sign with HMAC. Sprint 17 — minimal viable.
  return Buffer.from(JSON.stringify({ orgId: organizationId, ts: Date.now() })).toString('base64url')
}

export function parseOAuthState(state: string): { orgId: string; ts: number } | null {
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token to be issued
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
  id_token?: string
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google token exchange failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<GoogleTokenResponse>
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string
  expires_in: number
}> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }).toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google token refresh failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<{ access_token: string; expires_in: number }>
}

export interface GoogleUserInfo {
  email: string
  name?: string
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Google userinfo failed (${res.status})`)
  return res.json() as Promise<GoogleUserInfo>
}

// ---------------------------------------------------------------------------
// Calendar API
// ---------------------------------------------------------------------------

export interface CalendarEventInput {
  summary: string
  description?: string
  startIso: string
  endIso: string
  attendees?: { email: string }[]
  location?: string
  meetingUrl?: string
}

export interface CalendarEvent {
  id: string
  htmlLink?: string
}

export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: CalendarEventInput,
): Promise<CalendarEvent> {
  const body = {
    summary: event.summary,
    description: [
      event.description,
      event.meetingUrl ? `\n\nJoin: ${event.meetingUrl}` : '',
    ].filter(Boolean).join(''),
    start: { dateTime: event.startIso },
    end: { dateTime: event.endIso },
    attendees: event.attendees,
    location: event.location,
    reminders: { useDefault: true },
  }
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Calendar create failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<CalendarEvent>
}

export async function updateCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: CalendarEventInput,
): Promise<CalendarEvent> {
  const body = {
    summary: event.summary,
    description: [event.description, event.meetingUrl ? `\n\nJoin: ${event.meetingUrl}` : ''].filter(Boolean).join(''),
    start: { dateTime: event.startIso },
    end: { dateTime: event.endIso },
    attendees: event.attendees,
    location: event.location,
  }
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Calendar update failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<CalendarEvent>
}

export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )
  if (res.status === 410 || res.status === 404) return // already gone
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Calendar delete failed (${res.status}): ${text}`)
  }
}

// ---------------------------------------------------------------------------
// Token-mint helper with simple in-memory cache (60s buffer)
// ---------------------------------------------------------------------------

interface CachedToken {
  accessToken: string
  expiresAt: number // epoch ms
}
const cache = new Map<string, CachedToken>()

export async function mintAccessToken(refreshToken: string): Promise<string> {
  const now = Date.now()
  const cached = cache.get(refreshToken)
  if (cached && cached.expiresAt > now + 60_000) return cached.accessToken

  const fresh = await refreshAccessToken(refreshToken)
  cache.set(refreshToken, {
    accessToken: fresh.access_token,
    expiresAt: now + fresh.expires_in * 1000,
  })
  return fresh.access_token
}
