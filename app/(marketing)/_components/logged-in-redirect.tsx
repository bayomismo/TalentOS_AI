'use client'

/**
 * Tiny client-side redirector. If a session cookie exists, send
 * the user to /dashboard so they don't see the marketing page.
 *
 * Server-rendered marketing content stays untouched — this just
 * does a window.location.replace() on mount if the cookie is set.
 */
export function LoggedInRedirect() {
  if (typeof document === 'undefined') return null
  const hasSession =
    document.cookie.includes('authjs.session-token') ||
    document.cookie.includes('__Secure-authjs.session-token') ||
    document.cookie.includes('next-auth.session-token') ||
    document.cookie.includes('__Secure-next-auth.session-token')
  if (hasSession) {
    window.location.replace('/dashboard')
  }
  return null
}
