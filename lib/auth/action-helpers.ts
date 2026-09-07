/**
 * Sprint 9 — Action wrappers.
 *
 * Helpers that wrap a server-action callback with `requireAuth()` /
 * `requirePermission()` and translate the result into the existing
 * `ActionResult` shape used by client components.
 *
 * Usage:
 *
 *   export const createHiringRequestAction = withAuth(
 *     'hiring_request.create',
 *     async (input, ctx) => {
 *       // ctx.organizationId, ctx.userId are trusted
 *       return { ... }
 *     },
 *   )
 *
 * PART 13: every sensitive server action must call one of these
 * wrappers (or call `requireAuth()` directly). There is no other way
 * for an action to resolve identity.
 */

import { requireAuth, requirePermission, type AuthContext } from './authorize'
import type { Permission } from './types'

/** The action result shape used by the rest of the codebase. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable?: boolean } }

function toActionFailure(failure: { code: string; message: string }): ActionResult<never> {
  return { ok: false, error: { code: failure.code, message: failure.message } }
}

/**
 * Wraps an action callback with `requireAuth()`. The callback receives
 * the resolved `AuthContext` and the input.
 */
export function withAuth<TInput, TOutput>(
  callback: (input: TInput, ctx: AuthContext) => Promise<ActionResult<TOutput>>,
): (input: TInput) => Promise<ActionResult<TOutput>> {
  return async (input: TInput): Promise<ActionResult<TOutput>> => {
    const auth = await requireAuth()
    if (!auth.ok) return toActionFailure(auth)
    return callback(input, auth.data)
  }
}

/**
 * Wraps an action with `requirePermission(permission)`. The callback only
 * runs if the user has the permission; otherwise a typed failure is
 * returned.
 */
export function withPermission<TInput, TOutput>(
  permission: Permission,
  callback: (input: TInput, ctx: AuthContext) => Promise<ActionResult<TOutput>>,
): (input: TInput) => Promise<ActionResult<TOutput>> {
  return async (input: TInput): Promise<ActionResult<TOutput>> => {
    const auth = await requirePermission(permission)
    if (!auth.ok) return toActionFailure(auth)
    return callback(input, auth.data)
  }
}

/**
 * Throws an Error if the resource's `organizationId` does not match the
 * caller's. Use in the body of an action before any tenant-scoped write.
 */
export function requireSameOrganization(
  ctx: AuthContext,
  resourceOrgId: string | null | undefined,
  resourceKind = 'Resource',
): void {
  if (!resourceOrgId) {
    const err = new Error(`${resourceKind} not found`)
    err.name = 'NotFoundError'
    throw err
  }
  if (resourceOrgId !== ctx.organizationId) {
    const err = new Error(`${resourceKind} not found`)
    err.name = 'NotFoundError'
    throw err
  }
}
