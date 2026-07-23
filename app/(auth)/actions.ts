'use server'

/**
 * Sprint 16 — Password reset + forgot password actions.
 *
 * `requestPasswordResetAction` is the entry point. It accepts an email,
 * looks up the user (case-insensitive, org-agnostic on purpose: the
 * recipient should still get a reset link even if you don't know
 * which org they belong to), creates a PasswordResetToken, and
 * queues a password-reset email. The action NEVER reveals whether
 * the email is registered — it always returns ok, with a generic
 * "If an account exists for that email, we sent a reset link" message.
 * This is intentional to prevent user-enumeration attacks.
 *
 * `confirmPasswordResetAction` accepts a token + new password, looks
 * up the hashed token, verifies it's not expired or used, updates
 * the user's password (bumping `passwordChangedAt` to invalidate any
 * outstanding JWT sessions), and marks the token as used.
 *
 * Rate limiting: 5 requests / email / 10 minutes (same as signup).
 */

import { db } from '@/lib/db'
import { z } from 'zod'
import { recordAuditLog } from '@/lib/auth/audit'
import { hashPassword, validatePassword } from '@/lib/auth/password'
import { sendEmail } from '@/lib/email'
import { passwordResetEmail } from '@/lib/email/templates'
import {
  newPasswordResetToken,
  hashPasswordResetToken,
  passwordResetTokenExpiry,
  PASSWORD_RESET_TTL_MINUTES,
} from '@/lib/auth/password-reset'
import { rateLimit } from '@/lib/auth/rate-limit'

// --------------------------------------------------------------------
// requestPasswordResetAction
// --------------------------------------------------------------------

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // null is allowed (the form sends null when unavailable); undefined
  // is allowed too. We coerce to undefined so the rest of the code
  // can treat it as "not provided".
  requestIp: z.union([z.string(), z.null()]).optional().transform(v => v ?? undefined),
  requestUserAgent: z.union([z.string(), z.null()]).optional().transform(v => v ?? undefined),
})

export type RequestPasswordResetResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } }

export async function requestPasswordResetAction(
  input: unknown,
): Promise<RequestPasswordResetResult> {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) {
    console.error('[password-reset] parse failed:', JSON.stringify(parsed.error.issues))
    return {
      ok: false,
      error: {
        code: 'INVALID_EMAIL',
        message: 'Please enter a valid email address.',
      },
    }
  }
  const { email, requestIp, requestUserAgent } = parsed.data

  // Rate limit: 5 reset requests per email per 10 minutes.
  const rl = rateLimit(`password_reset:${email}`, 5, 10 * 60)
  if (!rl.ok) {
    // Don't tell the caller they're rate-limited — return ok so we
    // don't leak which emails have accounts. But still don't send.
    return { ok: true }
  }

  const user = await db.user.findFirst({
    where: { email, disabledAt: null },
    select: { id: true, firstName: true, email: true, organizationId: true },
  })

  if (!user) {
    // No account — silently return ok. (Do NOT send an email to a
    // stranger; that would let an attacker probe which emails are
    // registered.)
    return { ok: true }
  }

  const { token, tokenPrefix, tokenHash } = newPasswordResetToken()
  const expiresAt = passwordResetTokenExpiry()

  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      tokenPrefix,
      expiresAt,
      requestIp: requestIp ?? null,
      requestUserAgent: requestUserAgent ?? null,
    },
  })

  const tpl = passwordResetEmail({
    to: user.email,
    firstName: user.firstName,
    token,
    ttlMinutes: PASSWORD_RESET_TTL_MINUTES,
  })
  await sendEmail({
    kind: 'password_reset',
    to: user.email,
    from: tpl.from,
    subject: tpl.subject,
    text: tpl.text,
    html: tpl.html,
    metadata: { userId: user.id },
  }).catch(err => {
    // Don't fail the request — the user can retry. Just log the failure.
    console.error('[auth] failed to queue password reset email:', err)
  })

  await recordAuditLog({
    organizationId: user.organizationId,
    actorId: user.id,
    action: 'PASSWORD_RESET_REQUESTED' as never,
    targetType: 'user',
    targetId: user.id,
    outcome: 'success',
    metadata: { tokenPrefix } as any,
  }).catch(() => null)

  return { ok: true }
}

// --------------------------------------------------------------------
// confirmPasswordResetAction
// --------------------------------------------------------------------

const confirmSchema = z.object({
  token: z.string().min(20),
  password: z.string(),
})

export type ConfirmPasswordResetResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } }

export async function confirmPasswordResetAction(
  input: unknown,
): Promise<ConfirmPasswordResetResult> {
  const parsed = confirmSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: parsed.error.issues[0]?.message ?? 'Invalid input.',
      },
    }
  }
  const { token, password } = parsed.data

  // Validate password strength (same rules as signup).
  const pw = validatePassword(password)
  if (!pw.ok) {
    return { ok: false, error: { code: 'WEAK_PASSWORD', message: pw.reason ?? 'Password is too weak.' } }
  }

  const tokenHash = hashPasswordResetToken(token)
  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { id: true, email: true, organizationId: true, disabledAt: true } },
    },
  })

  if (!row || row.user.disabledAt) {
    return {
      ok: false,
      error: { code: 'INVALID_TOKEN', message: 'This reset link is invalid or has been used.' },
    }
  }
  if (row.usedAt) {
    return {
      ok: false,
      error: { code: 'TOKEN_USED', message: 'This reset link has already been used. Request a new one.' },
    }
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      error: { code: 'TOKEN_EXPIRED', message: 'This reset link has expired. Request a new one.' },
    }
  }

  const passwordHash = await hashPassword(password)
  const now = new Date()
  await db.$transaction([
    db.user.update({
      where: { id: row.user.id },
      data: {
        passwordHash,
        // Bumping passwordChangedAt invalidates any outstanding JWT
        // sessions on the user's next request. Same behavior as
        // self-service password change in Sprint 9.1.
        passwordChangedAt: now,
      },
    }),
    db.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: now },
    }),
  ])

  // Invalidate any other pending reset tokens for this user.
  await db.passwordResetToken.updateMany({
    where: { userId: row.user.id, usedAt: null, id: { not: row.id } },
    data: { usedAt: now },
  }).catch(() => null)

  await recordAuditLog({
    organizationId: row.user.organizationId,
    actorId: row.user.id,
    action: 'PASSWORD_RESET_COMPLETED' as never,
    targetType: 'user',
    targetId: row.user.id,
    outcome: 'success',
    metadata: { tokenPrefix: row.id.slice(0, 8) } as any,
  }).catch(() => null)

  return { ok: true }
}
