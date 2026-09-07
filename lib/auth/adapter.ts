/**
 * Sprint 9 — Adapter that converts `AuthFailure` into the existing
 * `ActionResult` shape used by the rest of the codebase.
 *
 * Existing actions return:
 *   { ok: false, error: { code, message, retryable } }
 *
 * `requireAuth()` / `requirePermission()` return `AuthFailure`:
 *   { ok: false, code, message }
 *
 * This adapter bridges the two so existing client code does not need
 * to change.
 */

import type { AuthFailure } from './types'

export type ActionFailure = { ok: false; error: { code: string; message: string; retryable: boolean } }

export function toActionFailure(failure: AuthFailure): ActionFailure {
  return {
    ok: false,
    error: {
      code: failure.code,
      message: failure.message,
      retryable: false,
    },
  }
}
