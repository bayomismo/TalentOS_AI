/**
 * Sprint 16 — Forgot password UI test.
 *
 * Walks the production forgot-password + reset-password pages.
 * Verifies the "Forgot password?" link on /login, the email form,
 * the success state, and the reset-password page (with both a
 * valid token from the outbox and an invalid token).
 */

import { chromium } from 'playwright'
import 'dotenv/config'
import { db } from '../lib/db'
import { randomUUID } from 'node:crypto'

const URL = 'https://talentos-ai-lime.vercel.app'

let pass = 0, fail = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}

async function main() {
  console.log('UI: Forgot password + reset password')

  // Seed a fresh test user so we don't touch the real admin.
  const admin = await db.user.findUnique({ where: { email: 'bayomismo@gmail.com' } })
  if (!admin) throw new Error('Admin not found')
  const testEmail = `audit-forgot-${randomUUID().slice(0, 6)}@gmail.com`
  const testUser = await db.user.create({
    data: {
      organizationId: admin.organizationId,
      email: testEmail,
      firstName: 'Forgot',
      lastName: 'Tester',
      role: 'VIEWER',
      passwordHash: '$2a$12$placeholderplaceholderplaceholderplaceholderplaceholderplaceholderplaceholder',
    },
  })

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage())

  // 1. /login has the "Forgot password?" link
  await page.goto(`${URL}/login`)
  await page.waitForLoadState('networkidle').catch(() => null)
  const forgotLink = page.locator('a:has-text("Forgot password?")')
  ok('forgot link visible on /login', await forgotLink.isVisible())
  await forgotLink.click()
  await page.waitForURL(/forgot-password/, { timeout: 10000 })
  ok('clicking forgot link navigates to /forgot-password', page.url().includes('/forgot-password'))

  // 2. Submit the form
  await page.waitForTimeout(500)
  const emailInput = page.locator('input[type="email"]')
  await emailInput.fill(testEmail)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(4000)
  const checkEmailHeading = page.locator('text=Check your email')
  ok('success state shown after submit', await checkEmailHeading.isVisible())

  // 3. Verify the outbox got a new row
  const outboxRow = await db.emailOutbox.findFirst({
    where: { kind: 'password_reset', to: testEmail },
    orderBy: { createdAt: 'desc' },
  })
  ok('outbox has new password_reset email', !!outboxRow)
  let realToken: string | undefined
  if (outboxRow) {
    const m = outboxRow.text.match(/#token=([A-Za-z0-9_-]+)/)
    realToken = m?.[1]
    ok('token extractable from email body', !!realToken)
  }

  // 4. Invalid token handling
  await page.goto(`${URL}/reset-password#token=invalid_token_xxxxxxxxxx`)
  await page.waitForLoadState('networkidle').catch(() => null)
  await page.waitForTimeout(1500)
  const invalidHeading = page.locator('text=Invalid reset link')
  ok('invalid token shows Invalid reset link', await invalidHeading.isVisible().catch(() => false))

  // 5. Valid token — fill the new password
  if (realToken) {
    await page.goto(`${URL}/reset-password#token=${realToken}`)
    await page.waitForLoadState('networkidle').catch(() => null)
    await page.waitForTimeout(1500)
    const newPass = 'NewPassword123!'
    await page.fill('input[autocomplete="new-password"]', newPass)
    // The second "new-password" input is the confirm field
    const newPassInputs = await page.locator('input[autocomplete="new-password"]').all()
    if (newPassInputs.length >= 2) {
      await newPassInputs[1].fill(newPass)
    }
    await page.click('button[type="submit"]')
    await page.waitForTimeout(2000)
    const successHeading = page.locator('text=Password updated')
    ok('Password updated heading shown', await successHeading.isVisible().catch(() => false))

    // 6. Verify password actually changed in DB
    const updated = await db.user.findUnique({ where: { id: testUser.id } })
    ok('password hash updated in DB',
      !!updated?.passwordHash && updated.passwordHash !== testUser.passwordHash,
    )
  }

  await page.screenshot({ path: '/tmp/forgot-password-test.png' })
  console.log('  Screenshot: /tmp/forgot-password-test.png')

  await browser.close()

  // Cleanup
  await db.emailOutbox.deleteMany({ where: { to: testEmail } })
  await db.passwordResetToken.deleteMany({ where: { userId: testUser.id } })
  await db.user.delete({ where: { id: testUser.id } }).catch(() => null)

  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
