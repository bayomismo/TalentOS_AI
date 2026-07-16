/**
 * Sprint 12 — Canonical application URL configuration.
 *
 * Production invitation links MUST use this canonical URL. We never
 * use VERCEL_URL, VERCEL_BRANCH_URL, or Host headers because those
 * resolve to preview deployments on Vercel and would break the
 * invitation flow.
 *
 * Configuration:
 *   - Set APP_URL=https://talentos-ai-lime.vercel.app in the Vercel
 *     Production environment. Do NOT use NEXT_PUBLIC_APP_URL because
 *     exposing it to the client is unnecessary and increases attack
 *     surface.
 *
 * Behaviour in production:
 *   - If APP_URL is missing or invalid, throw a clear error at the
 *     point of use. Never silently fall back to a Vercel preview URL.
 *
 * Behaviour in development:
 *   - If APP_URL is missing, fall back to http://localhost:3000 so
 *     local dev still works.
 */

const PROD_HOSTNAMES_THAT_ARE_PREVIEW = [
  // Vercel auto-generated preview hostnames look like
  //   <project>-<scope>-<owner>.vercel.app
  // We disallow any *.vercel.app that is NOT the canonical production
  // alias. This protects against accidental fallback to a preview URL.
]

const CANONICAL_PROD_HOST = 'talentos-ai-lime.vercel.app'

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

function isPreviewVercelHostname(hostname: string): boolean {
  // Allow only the canonical production alias; reject all other
  // *.vercel.app hostnames (those are preview deployments).
  if (hostname === CANONICAL_PROD_HOST) return false
  if (hostname.endsWith('.vercel.app')) return true
  return false
}

export function getAppUrl(): string {
  const raw = process.env.APP_URL
  if (raw && isValidUrl(raw)) {
    const u = new URL(raw)
    if (isPreviewVercelHostname(u.hostname)) {
      throw new Error(
        `APP_URL is set to a Vercel preview hostname (${u.hostname}). ` +
        `This is not allowed. Set APP_URL to the canonical production URL ` +
        `(https://${CANONICAL_PROD_HOST}) in the Vercel Production environment.`,
      )
    }
    return raw.replace(/\/$/, '')
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `APP_URL is not set in production. Set it to https://${CANONICAL_PROD_HOST} ` +
      `in the Vercel Production environment. Refusing to generate links that ` +
      `would otherwise point at a Vercel preview deployment.`,
    )
  }
  return 'http://localhost:3000'
}

export function buildAcceptInviteUrl(token: string): string {
  const base = getAppUrl()
  return `${base}/accept-invite#token=${encodeURIComponent(token)}`
}

export const CANONICAL_PRODUCTION_URL = `https://${CANONICAL_PROD_HOST}`
