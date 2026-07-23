import { chromium } from 'playwright'
import 'dotenv/config'
import { db } from '../lib/db'
import { randomUUID } from 'node:crypto'

const URL = 'http://localhost:3001'
let pass = 0, fail = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}

async function main() {
  console.log('UI: Forgot password — LOCAL end-to-end')

  const admin = await db.user.findUnique({ where: { email: 'bayomismo@gmail.com' } })
  if (!admin) throw new Error('Admin not found')
  const testEmail = `audit-local-${randomUUID().slice(0, 6)}@gmail.com`
  const testUser = await db.user.create({
    data: {
      organizationId: admin.organizationId,
      email: testEmail,
      firstName: 'Local',
      lastName: 'Test',
      role: 'VIEWER',
      passwordHash: '$2a$12$placeholder',
    },
  })

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage())

  // 1. Forgot link
  await page.goto(`${URL}/login`)
  await page.waitForLoadState('networkidle').catch(() => null)
  const forgotLink = page.locator('a:has-text("Forgot password?")')
  ok('forgot link visible on /login', await forgotLink.isVisible())
  await forgotLink.click()
  await page.waitForURL(/forgot-password/, { timeout: 10000 })
  ok('navigates to /forgot-password', page.url().includes('/forgot-password'))

  // 2. Submit form
  await page.waitForTimeout(2000)
  await page.fill('input[type="email"]', testEmail)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(5000)
  const checkEmail = page.locator('text=Check your email')
  ok('success state shown after submit', await checkEmail.isVisible().catch(() => false))

  // 3. Outbox
  const outboxRow = await db.emailOutbox.findFirst({
    where: { kind: 'password_reset', to: testEmail },
    orderBy: { createdAt: 'desc' },
  })
  ok('outbox has new password_reset email', !!outboxRow)

  // 4. Invalid token
  await page.goto(`${URL}/reset-password#token=invalid_token_xxxxxxxxxx`)
  await page.waitForLoadState('networkidle').catch(() => null)
  await page.waitForTimeout(2000)
  const invalidHeading = page.locator('text=Invalid reset link')
  ok('invalid token shows Invalid reset link', await invalidHeading.isVisible().catch(() => false))

  // 5. Valid token
  if (outboxRow) {
    const m = outboxRow.text.match(/#token=([A-Za-z0-9_-]+)/)
    const realToken = m?.[1]
    if (realToken) {
      await page.goto(`${URL}/reset-password#token=${realToken}`)
      await page.waitForLoadState('networkidle').catch(() => null)
      await page.waitForTimeout(2000)
      const newPass = 'NewPassword123!'
      const inputs = await page.locator('input[autocomplete="new-password"]').all()
      if (inputs.length >= 2) {
        await inputs[0].fill(newPass)
        await inputs[1].fill(newPass)
        await page.click('button[type="submit"]')
        await page.waitForTimeout(3000)
        const successHeading = page.locator('text=Password updated')
        ok('Password updated heading shown', await successHeading.isVisible().catch(() => false))

        const updated = await db.user.findUnique({ where: { id: testUser.id } })
        ok('password hash updated in DB',
          !!updated?.passwordHash && updated.passwordHash !== testUser.passwordHash,
        )
      }
    }
  }

  // Cleanup
  await db.emailOutbox.deleteMany({ where: { to: testEmail } })
  await db.passwordResetToken.deleteMany({ where: { userId: testUser.id } })
  await db.user.delete({ where: { id: testUser.id } }).catch(() => null)

  await browser.close()
  console.log(`\n========== ${pass} pass, ${fail} fail ==========`)
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
