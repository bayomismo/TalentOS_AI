/**
 * Sprint 9 + Sprint 13 — Middleware for route protection.
 *
 *   1. Unauthenticated user accessing protected route → /login
 *   2. Unauthenticated user accessing /signup → allowed
 *   3. Authenticated user with no/incomplete onboarding → /onboarding/...
 *   4. Authenticated user with complete onboarding → requested route
 *   5. Invitation recipient on /accept-invite → allowed even mid-onboarding
 *      (so an invited user can join the inviter's org without being
 *      forced into create-org onboarding)
 *   6. Signup page redirects signed-in users to onboarding or dashboard
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
  '/onboarding',  // The layout itself enforces auth
]

const PUBLIC_PREFIXES = [
  '/_next',
  '/favicon',
  '/icon',
  '/apple-icon',
  '/manifest',
  '/static',
  '/api/auth',
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
 * Decode the onboarding state from the Auth.js JWT cookie. This is a
 * best-effort, edge-compatible decode of the JWT payload (without
 * signature verification — the server still verifies the signature
 * on every request). The JWT carries the user's
 *   - userId
 *   - organizationId
 *   - role
 *   - passwordChangedAt
 * and we add onboardingStatus + onboardingStep on every login.
 */
function decodeJwtPayload(req: NextRequest): {
  userId?: string
  organizationId?: string
  role?: string
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
      // base64url decode
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
      const json = atob(padded)
      const payload = JSON.parse(json) as Record<string, unknown>
      return {
        userId: payload.userId as string | undefined,
        organizationId: payload.organizationId as string | undefined,
        role: payload.role as string | undefined,
        onboardingStatus: payload.onboardingStatus as string | undefined,
        onboardingStep: payload.onboardingStep as string | undefined,
        onboardingOrgStatus: payload.onboardingOrgStatus as string | undefined,
      }
    } catch {
      // ignore decode errors — fall through to treat as no session
    }
  }
  return {}
}

const PROTECTED_APP_PREFIXES = [
  '/dashboard',
  '/hiring-requests',
  '/candidates',
  '/interview-center',
  '/offers',
  '/job-library',
  '/decision-hub',
  '/analytics',
  '/reports',
  '/settings',
  '/copilot',
  '/ai-recruiter',
  '/admin',
]

function isProtectedAppPath(pathname: string): boolean {
  return PROTECTED_APP_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))
}

export function middleware(req: NextRequest) {
  const { nextUrl } = req
  const pathname = nextUrl.pathname

  if (isPublicPath(pathname)) {
    // For /signup with an existing session, redirect to onboarding/dashboard
    if (pathname === '/signup' && hasSessionCookie(req)) {
      const payload = decodeJwtPayload(req)
      if (payload.onboardingStatus === 'COMPLETED' && payload.onboardingOrgStatus === 'COMPLETED') {
        return NextResponse.redirect(new URL('/dashboard', nextUrl.origin))
      }
      return NextResponse.redirect(new URL('/onboarding/workspace', nextUrl.origin))
    }
    // For /login with an existing session, also redirect
    if (pathname === '/login' && hasSessionCookie(req)) {
      const payload = decodeJwtPayload(req)
      if (payload.onboardingStatus === 'COMPLETED' && payload.onboardingOrgStatus === 'COMPLETED') {
        return NextResponse.redirect(new URL('/dashboard', nextUrl.origin))
      }
      if (payload.onboardingStep && payload.onboardingStep !== 'COMPLETED') {
        const next = nextRouteForStep(payload.onboardingStep)
        if (next) return NextResponse.redirect(new URL(next, nextUrl.origin))
      }
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

  // If user is in a protected app path but onboarding is incomplete,
  // redirect to the appropriate onboarding step.
  if (isProtectedAppPath(pathname)) {
    const payload = decodeJwtPayload(req)
    if (payload.onboardingStatus !== 'COMPLETED' || payload.onboardingOrgStatus !== 'COMPLETED') {
      const next = nextRouteForStep(payload.onboardingStep ?? 'ACCOUNT_CREATED')
      if (next) return NextResponse.redirect(new URL(next, nextUrl.origin))
    }
  }

  return NextResponse.next()
}

function nextRouteForStep(step: string): string | null {
  switch (step) {
    case 'ACCOUNT_CREATED':
    case 'ORG_PENDING':
      return '/onboarding/workspace'
    case 'ORG_CREATED':
      return '/onboarding/company'
    case 'COMPANY_CONFIGURED':
      return '/onboarding/team'
    case 'TEAM_INVITED':
      return '/onboarding/done'
    default:
      return null
  }
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
