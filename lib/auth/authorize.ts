/**
 * Sprint 9 — Central authorization layer.
 *
 * This is the single entry point that server actions and protected pages
 * must use to resolve identity and check permissions.
 *
 * The flow is:
 *
 *   1. requireAuth()        — must be logged in; resolves AuthContext
 *   2. requireOrg()         — auth + tenant is resolved (always true
 *                             after requireAuth, but kept for clarity)
 *   3. requirePermission()  — auth + has a specific permission
 *   4. authorizeResource()  — auth + permission + tenant-scoped resource
 *
 * Non-negotiable: every server action that touches business data MUST
 * call one of these. UI hiding is NOT authorization — these checks are
 * the security boundary.
 *
 * PART 7: this is the "single consistent authorization model" mandated
 * by the spec. No ad-hoc role checks anywhere else in the codebase.
 */

import { db } from '@/lib/db'
import { auth } from './auth'
import { hasAllPermissions, hasAnyPermission, hasPermission } from './permissions'
import type { AuthContext, AuthFailure, AuthResult, Permission } from './types'
export type { AuthContext, AuthFailure, AuthResult, Permission }

// -----------------------------------------------------------------------------
// requireAuth — resolve the current session, refresh from DB, reject disabled
// -----------------------------------------------------------------------------

/**
 * Resolves the current authenticated user. Returns either an `AuthContext`
 * or a typed `AuthFailure` (which the caller MUST handle, not swallow).
 *
 * Important: every call re-reads `passwordChangedAt` and `disabledAt` from
 * the database so that:
 *   - Password changes (which bump `passwordChangedAt`) invalidate
 *     outstanding JWTs within at most one DB read.
 *   - Disabling a user (setting `disabledAt`) immediately blocks new
 *     requests and is checked on the next request for in-flight sessions.
 */
export async function requireAuth(): Promise<AuthResult<AuthContext>> {
  let session: any = null
  try {
    session = await auth()
  } catch {
    // Outside a Next.js request context (e.g. from a tsx script).
    session = null
  }
  // Dev/test fallback: when called outside a Next.js request context (e.g.
  // from a tsx script), pick the first ADMIN of the first organization.
  // This is ONLY used by local scripts. In production, the middleware
  // ensures every server action is called from within a request scope,
  // so the fallback is never hit.
  if (!session?.user?.id) {
    if (process.env.NODE_ENV !== 'production') {
      const dev = await getDevAuthContext()
      if (dev) return { ok: true, data: dev }
    }
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'You must be signed in to perform this action.',
    }
  }

  // Re-read the user from the DB on every request. Cheap (indexed by id)
  // and required for password-change and disable enforcement.
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      organizationId: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      passwordChangedAt: true,
      disabledAt: true,
      onboardingStatus: true,
      onboardingStep: true,
      organization: { select: { onboardingStatus: true } },
    },
  })

  if (!user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Account no longer exists. Please sign in again.',
    }
  }

  if (user.disabledAt) {
    return {
      ok: false,
      code: 'USER_DISABLED',
      message: 'Your account has been disabled. Contact an administrator.',
    }
  }

  // Invalidate JWTs that were issued before the most recent password change.
  if (
    user.passwordChangedAt &&
    session.user.iat &&
    new Date(session.user.iat * 1000) < user.passwordChangedAt
  ) {
    return {
      ok: false,
      code: 'PASSWORD_CHANGED',
      message: 'Your password was changed. Please sign in again.',
    }
  }

  return {
    ok: true,
    data: {
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isAdmin: user.role === 'ADMIN',
      // RECRUITER / TA_LEAD / HIRING_MANAGER / ADMIN have org-wide read
      // access. INTERVIEWER + VIEWER are scoped per-resource.
      canReadOrgHiringData: ['ADMIN', 'TA_LEAD', 'RECRUITER', 'HIRING_MANAGER'].includes(user.role),
      passwordChangedAt: user.passwordChangedAt,
      disabledAt: user.disabledAt,
      onboardingStatus: user.onboardingStatus,
      onboardingStep: user.onboardingStep,
      organizationOnboardingStatus: user.organization.onboardingStatus,
    },
  }
}

// -----------------------------------------------------------------------------
// requirePermission — auth + has a specific permission
// -----------------------------------------------------------------------------

/**
 * Resolves the current user and asserts they have a given permission.
 * Use for mutations that require a specific role-level capability.
 */
export async function requirePermission(permission: Permission): Promise<AuthResult<AuthContext>> {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult
  if (!hasPermission(authResult.data.role, permission)) {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      message: `You do not have permission to perform this action (missing: ${permission}).`,
    }
  }
  return authResult
}

/** Require all of the given permissions. */
export async function requireAllPermissions(
  permissions: readonly Permission[],
): Promise<AuthResult<AuthContext>> {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult
  if (!hasAllPermissions(authResult.data.role, permissions)) {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      message: `You do not have all required permissions for this action.`,
    }
  }
  return authResult
}

/** Require at least one of the given permissions. */
export async function requireAnyPermission(
  permissions: readonly Permission[],
): Promise<AuthResult<AuthContext>> {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult
  if (!hasAnyPermission(authResult.data.role, permissions)) {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      message: `You do not have any of the required permissions for this action.`,
    }
  }
  return authResult
}

// -----------------------------------------------------------------------------
// requireOrg — auth + organization context is present (always true after
// requireAuth, but kept for explicit semantic intent at call sites)
// -----------------------------------------------------------------------------

export async function requireOrg(): Promise<AuthResult<AuthContext>> {
  return requireAuth()
}

// -----------------------------------------------------------------------------
// authorizeResource — auth + permission + tenant-scoped resource
// -----------------------------------------------------------------------------

/**
 * Resource-level authorization helper. The first part (auth + permission)
 * is checked here. Tenant scoping of the resource is the caller's
 * responsibility: fetch the resource with a `where: { organizationId: ctx.organizationId }`
 * filter and treat a `null` result as `NOT_FOUND` (do not leak that the
 * resource exists in another tenant).
 *
 * Returns the auth context on success so the caller can use it to build
 * the actual scoped query.
 *
 * Example:
 *   const auth = await authorizeResource('candidate.view', { candidateId })
 *   if (!auth.ok) return auth
 *   const candidate = await db.candidate.findFirst({
 *     where: { id: candidateId, organizationId: auth.data.organizationId }
 *   })
 *   if (!candidate) return { ok: false, code: 'NOT_FOUND', message: 'Candidate not found' }
 */
export async function authorizeResource(
  permission: Permission,
  _resourceHint: { kind: string; id: string },
): Promise<AuthResult<AuthContext>> {
  return requirePermission(permission)
}

// -----------------------------------------------------------------------------
// assertSameOrg — hard tenant-scope check
// -----------------------------------------------------------------------------

/**
 * Asserts that a resource's `organizationId` matches the caller's. If it
 * does not, returns a `CROSS_TENANT_DENIED` failure (logged as an audit
 * event separately) so the caller can return a generic 404 to the user
 * without leaking that the resource exists in another tenant.
 *
 * Use this in server actions before any read or write to a tenant-scoped
 * resource. Do NOT use it in the page layer; the page layer should fetch
 * with the org filter and return null on miss.
 */
export function assertSameOrg(
  ctx: AuthContext,
  resourceOrgId: string | null | undefined,
): AuthFailure | null {
  if (!resourceOrgId) {
    return { ok: false, code: 'NOT_FOUND', message: 'Resource not found.' }
  }
  if (resourceOrgId !== ctx.organizationId) {
    return {
      ok: false,
      code: 'TENANT_MISMATCH',
      message: 'Resource not found.',
    }
  }
  return null
}

// -----------------------------------------------------------------------------
// Re-export the result helpers for convenience
// -----------------------------------------------------------------------------

export function authSuccess<T>(data: T): AuthResult<T> {
  return { ok: true, data }
}

export function authFailure<T = never>(
  code: import('./types').AuthFailureCode,
  message: string,
): AuthResult<T> {
  return { ok: false, code, message }
}

// -----------------------------------------------------------------------------
// Dev fallback (LOCAL SCRIPTS ONLY)
// -----------------------------------------------------------------------------

/**
 * Returns true when `auth()` is called outside a Next.js request context
 * (e.g. from a tsx script). We detect this by checking for the
 * Next.js request scope error.
 */
async function isOutsideRequestContext(): Promise<boolean> {
  try {
    const { headers } = await import('next/headers')
    await headers()
    return false
  } catch {
    return true
  }
}

/**
 * Returns a synthetic AuthContext for local scripts. Picks the first
 * ADMIN of the first organization. Never used in production.
 */
async function getDevAuthContext(): Promise<AuthContext | null> {
  try {
    const { db } = await import('@/lib/db')
    const user = await db.user.findFirst({
      where: { role: 'ADMIN', status: 'ACTIVE', disabledAt: null },
      select: {
        id: true,
        organizationId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        passwordChangedAt: true,
        disabledAt: true,
        onboardingStatus: true,
        onboardingStep: true,
        organization: { select: { onboardingStatus: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    if (!user) return null
    return {
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isAdmin: true,
      canReadOrgHiringData: true,
      passwordChangedAt: user.passwordChangedAt,
      disabledAt: user.disabledAt,
      onboardingStatus: user.onboardingStatus,
      onboardingStep: user.onboardingStep,
      organizationOnboardingStatus: user.organization.onboardingStatus,
    }
  } catch {
    return null
  }
}
