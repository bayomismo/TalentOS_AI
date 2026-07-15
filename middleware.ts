/**
 * Sprint 9 — Middleware for route protection.
 *
 * Part 12: redirects unauthenticated users to /login. Does NOT do
 * permission-level authorization — every page still calls requireAuth()
 * (or requirePermission) to enforce authz. Middleware is purely a
 * "do you have a session" gate.
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
  '/unauthorized',
  '/accept-invite',
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

export function middleware(req: NextRequest) {
  const { nextUrl } = req
  const pathname = nextUrl.pathname

  if (isPublicPath(pathname)) {
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
