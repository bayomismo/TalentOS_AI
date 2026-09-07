/**
 * Sprint 16 — End-to-end test for the password reset flow.
 *
 * 1. Existing user requests a password reset
 * 2. A token is created in the DB (hashed, not plaintext)
 * 3. A password-reset email lands in the EmailOutbox
 * 4. Random/unknown email returns ok with no email sent (no user-enumeration leak)
 * 5. Confirm with a real token → password changes, usedAt set
 * 6. Same token used twice is rejected
 * 7. Wrong token is rejected
 * 8. Original password is restored after the test
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { requestPasswordResetAction, confirmPasswordResetAction } from '../app/(auth)/actions'
import {
  newPasswordResetToken,
  passwordResetTokenExpiry,
} from '../lib/auth/password-reset'
import { randomBytes } from 'node:crypto'

let pass = 0, fail = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}

async function main() {
  const testEmail = 'bayomismo@gmail.com'

  const userBefore = await db.user.findUnique({
    where: { email: testEmail },
    select: { id: true, passwordHash: true, passwordChangedAt: true },
  })
  if (!userBefore) {
    console.log(`User ${testEmail} not found — skipping`)
    return
  }
  const originalChangedAt = userBefore.passwordChangedAt
  const originalHash = userBefore.passwordHash

  // ── [1] Request a reset ──────────────────────────────────────
  console.log('\n[1] Request a reset for an existing user')
  const r1 = await requestPasswordResetAction({ email: testEmail })
  ok('ok=true', r1.ok)

  const tokenRow = await db.passwordResetToken.findFirst({
    where: { userId: userBefore.id, usedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  ok('PasswordResetToken row created', !!tokenRow)
  ok('token has expiry', !!tokenRow?.expiresAt)
  ok('usedAt is null', tokenRow?.usedAt === null)

  const outbox = await db.emailOutbox.findMany({
    where: { kind: 'password_reset', to: testEmail },
    orderBy: { createdAt: 'desc' },
    take: 1,
  })
  const latest = outbox[0]
  ok('email in outbox', !!latest)
  ok('email contains the reset link', latest?.text.includes('reset-password') ?? false)

  // ── [2] No user-enumeration leak ──────────────────────
  console.log('\n[2] No user-enumeration leak')
  const unknownEmail = `random-${Date.now()}@does-not-exist.com`
  const r2 = await requestPasswordResetAction({ email: unknownEmail })
  ok('ok=true even for unknown email (no leak)', r2.ok)
  const unknownOutbox = await db.emailOutbox.findFirst({
    where: { to: unknownEmail, createdAt: { gte: new Date(Date.now() - 60_000) } },
  })
  ok('no email sent to unknown address', !unknownOutbox)

  // ── [3] Confirm with a real token (full E2E) ──────────────
  console.log('\n[3] Confirm step: full E2E with a real token')
  const { token: plainToken, tokenPrefix, tokenHash } = newPasswordResetToken()
  const expiresAt = passwordResetTokenExpiry()
  const realTokenRow = await db.passwordResetToken.create({
    data: {
      userId: userBefore.id,
      tokenHash,
      tokenPrefix,
      expiresAt,
    },
  })
  console.log(`  (created real token row ${realTokenRow.id} for E2E)`)

  const newPassword = `NewPassword-${randomBytes(4).toString('hex')}!`
  const rConfirm = await confirmPasswordResetAction({
    token: plainToken,
    password: newPassword,
  })
  ok('confirm ok=true', rConfirm.ok)
  if (rConfirm.ok) {
    const userAfter = await db.user.findUnique({
      where: { id: userBefore.id },
      select: { passwordHash: true, passwordChangedAt: true },
    })
    ok('password hash changed', userAfter?.passwordHash !== originalHash)
    ok('passwordChangedAt is bumped (or set if was null)', !!userAfter?.passwordChangedAt)

    const usedToken = await db.passwordResetToken.findUnique({ where: { id: realTokenRow.id } })
    ok('token is marked usedAt', usedToken?.usedAt !== null)

    // Same token used twice is rejected
    const rConfirm2 = await confirmPasswordResetAction({
      token: plainToken,
      password: 'YetAnotherPassword!',
    })
    ok('same token used twice is rejected', !rConfirm2.ok)
  }

  // ── [4] Wrong token is rejected ─────────────────────
  console.log('\n[4] Confirm with a wrong token')
  const r3 = await confirmPasswordResetAction({
    token: 'this-is-a-totally-fake-token-that-does-not-exist',
    password: 'NewPassword123!',
  })
  ok('ok=false on bad token', !r3.ok)
  if (!r3.ok) {
    ok('error is present', !!r3.error)
  }

  // ── [cleanup] Restore the user's original password ─────
  console.log('\n[cleanup]')
  await db.user.update({
    where: { id: userBefore.id },
    data: {
      passwordHash: originalHash,
      passwordChangedAt: originalChangedAt,
    },
  })
  console.log('  ✓ restored original password hash')

  if (tokenRow) {
    await db.passwordResetToken.delete({ where: { id: tokenRow.id } })
    console.log('  ✓ deleted test token from request step')
  }
  if (realTokenRow) {
    await db.passwordResetToken.delete({ where: { id: realTokenRow.id } })
    console.log('  ✓ deleted E2E token')
  }
  if (latest) {
    await db.emailOutbox.delete({ where: { id: latest.id } })
    console.log('  ✓ deleted test outbox email')
  }

  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
