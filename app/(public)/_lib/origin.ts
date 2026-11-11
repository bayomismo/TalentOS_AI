/**
 * Sprint 19 — Request-derived origin helpers (audit P2-23).
 *
 * The white-label public surfaces used to fall back to a hard-coded
 * `https://talentos-ai-lime.vercel.app`. On any other deployment (a
 * preview, a staging box, a customer's own domain) every "Back to
 * TalentOS" link, every copied public job URL and every "Review
 * application" link pointed at the vendor's production host.
 *
 * Resolution order:
 *   1. `APP_URL` — the canonical application URL. Already configured in
 *      every environment and used by `lib/url/canonical.ts` for the
 *      invitation / password-reset links. It is the right answer for a
 *      link that has to survive being pasted into an email.
 *   2. The request's own host — so a deployment that has not set APP_URL
 *      still produces links that point at ITSELF rather than at the
 *      vendor.
 *
 * Never returns the vendor's production host as a fallback.
 */

import { headers } from 'next/headers'

/**
 * The configured canonical origin, or '' when APP_URL is not set.
 * Never throws (unlike `getAppUrl()`, which deliberately throws in
 * production so a misconfigured deployment cannot generate broken
 * links). A public page must render even when the env var is missing.
 */
export function configuredAppOrigin(): string {
  const raw = process.env.APP_URL?.trim()
  if (!raw) return ''
  return raw.replace(/\/+$/, '')
}

/**
 * The origin of the current request, derived from server-side headers.
 * `host` is set by the platform; `x-forwarded-host` is the fallback for
 * proxies that rewrite it.
 */
export async function requestOrigin(): Promise<string> {
  let h: Awaited<ReturnType<typeof headers>>
  try {
    h = await headers()
  } catch {
    return ''
  }
  const host = h.get('host') ?? h.get('x-forwarded-host')
  if (!host) return ''
  const forwardedProto = h.get('x-forwarded-proto')
  const proto =
    forwardedProto ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  return `${proto}://${host}`
}

/**
 * The best origin for an absolute link: APP_URL when configured,
 * otherwise the current request's own origin.
 */
export async function absoluteOrigin(): Promise<string> {
  const configured = configuredAppOrigin()
  if (configured) return configured
  return requestOrigin()
}

/**
 * Builds an absolute URL for a path on this application.
 * Falls back to the path itself (a site-relative link) when no origin
 * can be determined — a relative link is still correct, a link to the
 * wrong host is not.
 */
export async function absoluteUrl(path: string): Promise<string> {
  const suffix = path.startsWith('/') ? path : `/${path}`
  const origin = await absoluteOrigin()
  return origin ? `${origin}${suffix}` : suffix
}
