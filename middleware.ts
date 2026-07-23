/**
 * Sprint 9 + Sprint 13 — Middleware for route protection.
 *
 *   1. Unauthenticated user accessing protected route → /login
 *   2. Unauthenticated user accessing /signup → allowed
 *   3. Authenticated user accessing /signup or /login → sent to
 *      /onboarding/... or /dashboard based on stored JWT onboarding
 *      state.
 *   4. Onboarding state checks for protected app pages are done by
 *      the page's own server component (which has DB access), not
 *      the middleware. This avoids a redirect loop when the JWT
 *      carries stale onboarding state right after a step transition.
 *   5. The /onboarding/* layout itself enforces authentication and
 *      the correct step (DB-backed).
 *
 * The middleware uses Auth.js v5's cookie-name conventions to detect a
 * session without depending on the full Auth.js runtime (which is
 * Node.js-only in v5 beta). Edge-compatible.
 */
import { NextResponse, type NextRequest } from 'next/server'

// Auth.js v5 default cookie names
const SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  // NextAuth v4 fallback
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
]

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/unauthorized',
  '/accept-invite',
  '/forgot-password',
  '/reset-password',
  '/onboarding',  // The layout itself enforces auth
  '/jobs',        // Public job postings (Sprint 17)
]

const PUBLIC_PREFIXES = [
  '/_next',
  '/favicon',
  '/icon',
  '/apple-icon',
  '/manifest',
  '/static',
  '/api/auth',
  '/api/health',
  '/api/public',
]

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return true
  }
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return true
  }
  if (pathname === '/') {
    return true
  }
  return false
}

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some(name => req.cookies.has(name))
}

/**
 * Decode the onboarding step from the Auth.js JWT cookie. Used only
 * to redirect /signup and /login for already-signed-in users. We do
 * NOT use this for protected-app-route enforcement (that's done by
 * the page itself) to avoid stale-JWT redirect loops.
 */
function decodeJwtPayload(req: NextRequest): {
  onboardingStatus?: string
  onboardingStep?: string
  onboardingOrgStatus?: string
} {
  for (const name of SESSION_COOKIE_NAMES) {
    const cookie = req.cookies.get(name)
    if (!cookie) continue
    try {
      const parts = cookie.value.split('.')
      if (parts.length < 2) continue
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
      const json = atob(padded)
      const payload = JSON.parse(json) as Record<string, unknown>
      return {
        onboardingStatus: payload.onboardingStatus as string | undefined,
        onboardingStep: payload.onboardingStep as string | undefined,
        onboardingOrgStatus: payload.onboardingOrgStatus as string | undefined,
      }
    } catch {
      // ignore
    }
  }
  return {}
}

export function middleware(req: NextRequest) {
  const { nextUrl } = req
  const pathname = nextUrl.pathname

  if (isPublicPath(pathname)) {
    // For /signup or /login with an existing session, send the user
    // to /onboarding/workspace (if they haven't completed) or
    // /dashboard (if they have). The /onboarding layout itself
    // re-reads the DB and forwards to the right step.
    if ((pathname === '/signup' || pathname === '/login') && hasSessionCookie(req)) {
      const payload = decodeJwtPayload(req)
      if (payload.onboardingStatus === 'COMPLETED' && payload.onboardingOrgStatus === 'COMPLETED') {
        return NextResponse.redirect(new URL('/dashboard', nextUrl.origin))
      }
      return NextResponse.redirect(new URL('/onboarding/workspace', nextUrl.origin))
    }
    return NextResponse.next()
  }

  if (!hasSessionCookie(req)) {
    const loginUrl = new URL('/login', nextUrl.origin)
    if (pathname !== '/') {
      loginUrl.searchParams.set('callbackUrl', pathname + nextUrl.search)
    }
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static
     * - _next/image
     * - favicon.ico, icons, etc.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-light-32x32.png|icon-dark-32x32.png|apple-icon.png).*)',
  ],
}
