/**
 * Sprint 16 — Password reset token utilities.
 *
 * Same pattern as the invitation tokens: 32-byte random secret,
 * persisted as SHA-256 hash + 8-char plaintext prefix for the UI.
 * TTL 1 hour, single use.
 */

import { createHash, randomBytes } from 'crypto'

const PREFIX_LEN = 8
export const PASSWORD_RESET_TTL_MINUTES = 60

function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex')
}

export interface CreatePasswordResetTokenInput {
  userId: string
}

export interface CreatePasswordResetTokenResult {
  token: string  // plaintext — to be put in the email link, NEVER persisted
  tokenPrefix: string
  expiresAt: Date
}

export function newPasswordResetToken(): { token: string; tokenPrefix: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  const tokenPrefix = token.slice(0, PREFIX_LEN)
  const tokenHash = hashToken(token)
  return { token, tokenPrefix, tokenHash }
}

export function hashPasswordResetToken(plain: string): string {
  return hashToken(plain)
}

export function passwordResetTokenExpiry(): Date {
  return new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000)
}
