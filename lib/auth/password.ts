/**
 * Sprint 9 — Password hashing utilities.
 *
 * PART 2: Use bcryptjs (pure JS, serverless-safe). Cost factor 12 — a
 * good balance between security and latency on Vercel. Never log
 * passwords or hashes. Never return hashes to the client.
 */

import bcrypt from 'bcryptjs'

const BCRYPT_COST = 12

/**
 * Hashes a password using bcrypt. Returns the hash (suitable for
 * `User.passwordHash`). Throws on empty input.
 */
export async function hashPassword(plain: string): Promise<string> {
  if (!plain) throw new Error('Password must not be empty')
  return bcrypt.hash(plain, BCRYPT_COST)
}

/**
 * Verifies a password against a bcrypt hash. Returns false on any error
 * (invalid hash format, empty input, etc.) — never throws.
 */
export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false
  try {
    return await bcrypt.compare(plain, hash)
  } catch {
    return false
  }
}

/**
 * Validates a password against the policy. Returns `{ ok: true }` or
 * `{ ok: false, reason }`. Mirrors common-sense rules: 10+ chars, not
 * all spaces, not a top-100 common password.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'qwerty', 'qwerty123', '123456',
  '12345678', '123456789', '1234567890', '111111', '000000', 'abc123',
  'iloveyou', 'admin', 'administrator', 'welcome', 'letmein', 'monkey',
  'dragon', 'sunshine', 'princess', 'master', 'football', 'baseball',
])

export type PasswordValidation = { ok: true } | { ok: false; reason: string }

export function validatePassword(plain: string): PasswordValidation {
  if (!plain) return { ok: false, reason: 'Password is required' }
  if (plain.length < 10) return { ok: false, reason: 'Password must be at least 10 characters' }
  if (plain.length > 128) return { ok: false, reason: 'Password must be 128 characters or fewer' }
  if (plain.trim().length !== plain.length) return { ok: false, reason: 'Password must not start or end with whitespace' }
  if (COMMON_PASSWORDS.has(plain.toLowerCase())) return { ok: false, reason: 'Password is too common' }
  // Require at least one letter and one digit
  if (!/[a-zA-Z]/.test(plain)) return { ok: false, reason: 'Password must contain at least one letter' }
  if (!/[0-9]/.test(plain)) return { ok: false, reason: 'Password must contain at least one digit' }
  return { ok: true }
}
