/**
 * Sprint 9 — Middleware for route protection.
 *
 * Part 12: redirects unauthenticated users to /login. Does NOT do
 * permission-level authorization — every page still calls requireAuth()
 * (or requirePermission) to enforce authz. Middleware is purely a
 * "do you have a session" gate.
 *
 * The middleware uses Auth.js v5's `auth` helper, which understands
 * the JWT cookie. We exclude the login page, the Auth.js API routes,
 * static assets, and the public invite-accept page.
 */
import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

const PUBLIC_PATHS = [
  '/login',
  '/unauthorized',
  '/accept-invite',
  '/api/auth',
]

const PUBLIC_PREFIXES = [
  '/_next',
  '/favicon',
  '/icon',
  '/apple-icon',
  '/manifest',
  '/static',
  '/api/public',
]

export default auth((req) => {
  const { nextUrl } = req
  const pathname = nextUrl.pathname

  // Allow Auth.js API routes through
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Root path — let it through (the page handles redirects)
  if (pathname === '/') {
    return NextResponse.next()
  }

  // No session → redirect to /login
  if (!req.auth) {
    const loginUrl = new URL('/login', nextUrl.origin)
    loginUrl.searchParams.set('callbackUrl', pathname + nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  // Run on every route except static assets and the public paths above
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-light-32x32.png|icon-dark-32x32.png|apple-icon.png).*)'],
}
